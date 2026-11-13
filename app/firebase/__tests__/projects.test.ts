/**
 * @jest-environment node
 */
import {
  assertProjectForDeployment,
  assertWebConfigForDeployment,
  assertWebProjectMatchesAdmin,
  deploymentEnvironment,
  FIREBASE_PROJECTS,
  FirebaseProjectError,
  knownProjectIds,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  type FirebaseProjects,
  sha256Hex,
  type WebConfigBindings,
} from "../projects";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_CONFIG_BINDINGS } from "../web-config-bindings";

const PROD = "devtalk-88046";
const STAGING = "devtalk-staging";
const WITH_STAGING: FirebaseProjects = FIREBASE_PROJECTS;
const NO_STAGING: FirebaseProjects = { production: PROD, staging: null };

function errorFrom(fn: () => unknown): FirebaseProjectError {
  try {
    fn();
  } catch (error) {
    return error as FirebaseProjectError;
  }
  throw new Error("expected a FirebaseProjectError");
}

// Synthetic, clearly fake keys and configs (no real keys anywhere in tests).
// The fingerprints are pinned literals, computed once outside the code under
// test with: printf '%s' "<key>" | shasum -a 256
const PROD_KEY = "FAKE-PROD-API-KEY-marker";
const STAGING_KEY = "FAKE-STAGING-API-KEY-marker";
const PROD_KEY_SHA256 = "39fa23e8da4b80974f48235bb5b3cafd794e12889e9ce5d261ab0bfb615ebafc";
const STAGING_KEY_SHA256 = "394a556adff08803ae3e6b1d53f03a433e6d24cfdabccfa5e4aa46e0b397a426";
const PROD_WEB = {
  apiKeySha256: PROD_KEY_SHA256,
  authDomain: `${PROD}.firebaseapp.com`,
  projectId: PROD,
  storageBucket: `${PROD}.firebasestorage.app`,
  messagingSenderId: "111111111111",
  appId: "1:111111111111:web:fakeprodapp",
};
const STAGING_WEB = {
  apiKeySha256: STAGING_KEY_SHA256,
  authDomain: `${STAGING}.firebaseapp.com`,
  projectId: STAGING,
  storageBucket: `${STAGING}.firebasestorage.app`,
  messagingSenderId: "222222222222",
  appId: "1:222222222222:web:fakestagingapp",
};
const BINDINGS: WebConfigBindings = { production: PROD_WEB, staging: STAGING_WEB };
const KEYS = new Map([[PROD_WEB, PROD_KEY], [STAGING_WEB, STAGING_KEY]]);
const asEnv = (c: typeof PROD_WEB) => ({
  VITE_FIREBASE_API_KEY: KEYS.get(c)!,
  VITE_FIREBASE_AUTH_DOMAIN: c.authDomain,
  VITE_FIREBASE_PROJECT_ID: c.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: c.storageBucket,
  VITE_FIREBASE_MESSAGING_SENDER_ID: c.messagingSenderId,
  VITE_FIREBASE_APP_ID: c.appId,
});
const PREVIEW = { VERCEL_ENV: "preview", DEVTALK_FIREBASE_ENV: "staging" };
const PRODUCTION = { VERCEL_ENV: "production", DEVTALK_FIREBASE_ENV: "production" };
const ALL_VALUES = [...Object.values(PROD_WEB), ...Object.values(STAGING_WEB), PROD_KEY, STAGING_KEY];
const check = (env: Record<string, string>, bindings: WebConfigBindings = BINDINGS) =>
  () => assertWebConfigForDeployment(env, WITH_STAGING, bindings);

describe("configured projects", () => {
  it("maps production and staging to exactly these two projects", () => {
    expect(PRODUCTION_PROJECT_ID).toBe(PROD);
    expect(STAGING_PROJECT_ID).toBe(STAGING);
    expect(FIREBASE_PROJECTS).toEqual({ production: PROD, staging: STAGING });
    expect(knownProjectIds()).toEqual([PROD, STAGING]);
  });

  it.each(["codesocietycapstone", "devtalk-staging-2", "devtalk-stagin", "DEVTALK-STAGING", "devtalk-88046-staging", "devtalk", "*"])(
    "knows nothing about %s",
    (id) => {
      expect(knownProjectIds()).not.toContain(id);
      expect(() => assertProjectForDeployment({}, "FIREBASE_ADMIN_PROJECT_ID", id)).toThrow(FirebaseProjectError);
      expect(() => assertProjectForDeployment({ VERCEL_ENV: "preview" }, "FIREBASE_ADMIN_PROJECT_ID", id)).toThrow(FirebaseProjectError);
    }
  );

  it("never uses one project for both environments", () => {
    expect(FIREBASE_PROJECTS.staging).not.toBe(FIREBASE_PROJECTS.production);
  });
});

describe("deploymentEnvironment", () => {
  it.each([
    [{}, null],
    [{ DEVTALK_FIREBASE_ENV: "production" }, "production"],
    [{ DEVTALK_FIREBASE_ENV: " staging " }, "staging"],
    [{ VERCEL_ENV: "production" }, "production"],
    [{ VERCEL_ENV: "preview" }, "staging"],
    [{ VERCEL_ENV: "development" }, "staging"],
    [{ DEVTALK_FIREBASE_ENV: "staging", VERCEL_ENV: "preview" }, "staging"],
    [{ DEVTALK_FIREBASE_ENV: "production", VERCEL_ENV: "production" }, "production"],
  ])("reads %j as %s", (env, expected) => {
    expect(deploymentEnvironment(env)).toBe(expected);
  });

  it.each([
    [{ DEVTALK_FIREBASE_ENV: "production", VERCEL_ENV: "preview" }, "DEVTALK_FIREBASE_ENV does not match VERCEL_ENV."],
    [{ DEVTALK_FIREBASE_ENV: "staging", VERCEL_ENV: "production" }, "DEVTALK_FIREBASE_ENV does not match VERCEL_ENV."],
    [{ DEVTALK_FIREBASE_ENV: "prod" }, 'DEVTALK_FIREBASE_ENV must be "production" or "staging".'],
    [{ VERCEL_ENV: "qa" }, "VERCEL_ENV has an unrecognized value."],
  ])("refuses %j", (env, message) => {
    const error = errorFrom(() => deploymentEnvironment(env));
    expect(error).toBeInstanceOf(FirebaseProjectError);
    expect(error.message).toBe(message);
  });
});

describe("assertProjectForDeployment", () => {
  const check = (env: Record<string, string>, id: string, projects = WITH_STAGING) =>
    () => assertProjectForDeployment(env, "FIREBASE_ADMIN_PROJECT_ID", id, projects);

  it("accepts each environment's own project", () => {
    expect(check({ VERCEL_ENV: "production" }, PROD)()).toBe(PROD);
    expect(check({ VERCEL_ENV: "preview" }, STAGING)()).toBe(STAGING);
    expect(check({ DEVTALK_FIREBASE_ENV: "staging" }, ` ${STAGING} `)()).toBe(STAGING);
  });

  it("refuses production credentials in a Preview, without echoing the project", () => {
    const error = errorFrom(check({ VERCEL_ENV: "preview" }, PROD));
    expect(error.message).toBe("FIREBASE_ADMIN_PROJECT_ID is not the staging project.");
    expect(error.message).not.toContain(PROD);
  });

  it("refuses staging credentials in Production", () => {
    expect(errorFrom(check({ VERCEL_ENV: "production" }, STAGING)).message).toBe(
      "FIREBASE_ADMIN_PROJECT_ID is not the production project."
    );
  });

  it("refuses every staging deployment while no staging project is configured", () => {
    for (const id of [PROD, STAGING]) {
      expect(errorFrom(check({ VERCEL_ENV: "preview" }, id, NO_STAGING)).message).toBe(
        "No Firebase project is configured for staging deployments."
      );
    }
  });

  it("with no declared environment, accepts only our projects", () => {
    expect(check({}, PROD)()).toBe(PROD);
    expect(check({}, STAGING)()).toBe(STAGING);
    for (const id of ["codesocietycapstone", "devtalk-88046-staging", ""]) {
      const error = errorFrom(check({}, id));
      expect(error.message).toBe("FIREBASE_ADMIN_PROJECT_ID is not an allowed project for this deployment.");
    }
    expect(errorFrom(check({}, STAGING, NO_STAGING)).message).toContain("not an allowed project");
  });
});

describe("assertWebConfigForDeployment", () => {
  it("does nothing when no environment is declared (local builds)", () => {
    expect(check({ VITE_FIREBASE_PROJECT_ID: "anything" })).not.toThrow();
  });

  it("accepts each environment's complete recorded configuration", () => {
    expect(check({ ...PREVIEW, ...asEnv(STAGING_WEB) })).not.toThrow();
    expect(check({ VERCEL_ENV: "preview", ...asEnv(STAGING_WEB) })).not.toThrow();
    expect(check({ ...PRODUCTION, ...asEnv(PROD_WEB) })).not.toThrow();
    const padded = Object.fromEntries(Object.entries(asEnv(STAGING_WEB)).map(([k, v]) => [k, ` ${v} `]));
    expect(check({ ...PREVIEW, ...padded })).not.toThrow();
  });

  it("refuses a production API key in a Preview whose other settings are staging", () => {
    const env = { ...PREVIEW, ...asEnv(STAGING_WEB), VITE_FIREBASE_API_KEY: PROD_KEY };
    expect(errorFrom(check(env)).message).toBe(
      "VITE_FIREBASE_API_KEY does not match the recorded staging fingerprint."
    );
  });

  it("refuses a staging API key in Production", () => {
    const env = { ...PRODUCTION, ...asEnv(PROD_WEB), VITE_FIREBASE_API_KEY: STAGING_KEY };
    expect(errorFrom(check(env)).message).toBe(
      "VITE_FIREBASE_API_KEY does not match the recorded production fingerprint."
    );
  });

  it.each(["FAKE-UNKNOWN-KEY-marker", "", "  "])("refuses an unknown or empty API key (%j)", (apiKey) => {
    expect(check({ ...PREVIEW, ...asEnv(STAGING_WEB), VITE_FIREBASE_API_KEY: apiKey })).toThrow(FirebaseProjectError);
  });

  it.each([
    ["VITE_FIREBASE_APP_ID", PROD_WEB.appId],
    ["VITE_FIREBASE_MESSAGING_SENDER_ID", PROD_WEB.messagingSenderId],
    ["VITE_FIREBASE_AUTH_DOMAIN", PROD_WEB.authDomain],
    ["VITE_FIREBASE_STORAGE_BUCKET", PROD_WEB.storageBucket],
    ["VITE_FIREBASE_AUTH_DOMAIN", `${STAGING}.web.app`],
  ])("refuses a Preview whose %s is %s", (variable, value) => {
    const env = { ...PREVIEW, ...asEnv(STAGING_WEB), [variable]: value };
    expect(errorFrom(check(env)).message).toBe(`${variable} does not match the recorded staging web configuration.`);
  });

  it("refuses the whole production config in a Preview, and staging in Production", () => {
    expect(errorFrom(check({ ...PREVIEW, ...asEnv(PROD_WEB) })).message).toBe(
      "VITE_FIREBASE_PROJECT_ID is not the staging project."
    );
    expect(errorFrom(check({ ...PRODUCTION, ...asEnv(STAGING_WEB) })).message).toBe(
      "VITE_FIREBASE_PROJECT_ID is not the production project."
    );
  });

  it("refuses conflicting environment declarations", () => {
    const env = { VERCEL_ENV: "preview", DEVTALK_FIREBASE_ENV: "production", ...asEnv(PROD_WEB) };
    expect(errorFrom(check(env)).message).toBe("DEVTALK_FIREBASE_ENV does not match VERCEL_ENV.");
  });

  it("fails closed while an environment's configuration is not recorded", () => {
    expect(errorFrom(check({ ...PREVIEW, ...asEnv(STAGING_WEB) }, { production: PROD_WEB, staging: null })).message).toBe(
      "No verified web configuration is recorded for staging deployments."
    );
    expect(errorFrom(check({ ...PRODUCTION, ...asEnv(PROD_WEB) }, { production: null, staging: STAGING_WEB })).message).toBe(
      "No verified web configuration is recorded for production deployments."
    );
  });

  it("refuses a recorded binding that names the other environment's project", () => {
    const swapped = { production: PROD_WEB, staging: PROD_WEB };
    expect(errorFrom(check({ ...PREVIEW, ...asEnv(STAGING_WEB) }, swapped)).message).toBe(
      "The recorded staging web configuration names another project."
    );
  });

  it("pins the synthetic fingerprints independently of the code under test", () => {
    expect(sha256Hex(STAGING_KEY)).toBe(STAGING_KEY_SHA256);
    expect(sha256Hex(PROD_KEY)).toBe(PROD_KEY_SHA256);
  });

  it("refuses a missing API key, and a key differing only by case", () => {
    const { VITE_FIREBASE_API_KEY: _omit, ...withoutKey } = asEnv(STAGING_WEB);
    expect(errorFrom(check({ ...PREVIEW, ...withoutKey })).message).toBe(
      "VITE_FIREBASE_API_KEY does not match the recorded staging fingerprint."
    );
    expect(check({ ...PREVIEW, ...asEnv(STAGING_WEB), VITE_FIREBASE_API_KEY: STAGING_KEY.toLowerCase() })).toThrow(FirebaseProjectError);
  });

  it.each([
    ["missing", ""],
    ["too short", STAGING_KEY_SHA256.slice(1)],
    ["uppercase", STAGING_KEY_SHA256.toUpperCase()],
    ["the key itself instead of its hash", STAGING_KEY],
  ])("refuses a %s recorded fingerprint", (_label, apiKeySha256) => {
    const bindings = { production: PROD_WEB, staging: { ...STAGING_WEB, apiKeySha256 } };
    expect(errorFrom(check({ ...PREVIEW, ...asEnv(STAGING_WEB) }, bindings)).message).toBe(
      "The recorded staging API key fingerprint is missing or malformed."
    );
  });

  it("refuses a valid key under the other environment's fingerprint", () => {
    const bindings = { production: PROD_WEB, staging: { ...STAGING_WEB, apiKeySha256: PROD_KEY_SHA256 } };
    expect(check({ ...PREVIEW, ...asEnv(STAGING_WEB) }, bindings)).toThrow("does not match the recorded staging fingerprint");
  });

  it("refuses a declared deployment with no web project", () => {
    expect(check({ DEVTALK_FIREBASE_ENV: "staging" })).toThrow("VITE_FIREBASE_PROJECT_ID must be set.");
  });

  it("never echoes configuration values in its errors", () => {
    const cases = [
      { ...PREVIEW, ...asEnv(PROD_WEB) },
      { ...PREVIEW, ...asEnv(STAGING_WEB), VITE_FIREBASE_API_KEY: PROD_KEY },
      { ...PRODUCTION, ...asEnv(PROD_WEB), VITE_FIREBASE_APP_ID: STAGING_WEB.appId },
      { ...PREVIEW, ...asEnv(STAGING_WEB), VITE_FIREBASE_MESSAGING_SENDER_ID: "333333333333" },
    ];
    for (const env of cases) {
      const message = errorFrom(check(env)).message;
      for (const value of [...ALL_VALUES, "333333333333"]) expect(message).not.toContain(value);
    }
  });
});

describe("recorded web configuration (web-config-bindings.ts)", () => {
  const recorded = Object.entries(WEB_CONFIG_BINDINGS).filter(
    (entry): entry is [keyof typeof WEB_CONFIG_BINDINGS, NonNullable<(typeof WEB_CONFIG_BINDINGS)["staging"]>] => entry[1] !== null
  );

  it("names each environment's own project", () => {
    for (const [environment, binding] of recorded) expect(binding.projectId).toBe(FIREBASE_PROJECTS[environment]);
  });

  it("shares no identifying value between production and staging", () => {
    const { production, staging } = WEB_CONFIG_BINDINGS;
    if (!production || !staging) return;
    for (const field of ["apiKeySha256", "appId", "messagingSenderId", "projectId", "authDomain", "storageBucket"] as const) {
      expect(staging[field]).not.toBe(production[field]);
    }
  });

  it("pins exactly the values the owner supplied on 2026-11-11 (toEqual: nothing extra)", () => {
    expect(WEB_CONFIG_BINDINGS.staging).toEqual({
      apiKeySha256: "5103f2c8e5bfc162d1dad7c92c6703dd94e874f0e1ad06e80a8fe801b84bd1ea",
      projectId: "devtalk-staging",
      messagingSenderId: "437316971319",
      appId: "1:437316971319:web:1fa17d9b45b24f03a888b2",
      authDomain: "devtalk-staging.firebaseapp.com",
      storageBucket: "devtalk-staging.firebasestorage.app",
    });
    expect(WEB_CONFIG_BINDINGS.production).toEqual({
      apiKeySha256: "6cb112a50721e32b8e1eab7599d1156527e28a049bca387c064d2918ee351a77",
      projectId: "devtalk-88046",
      messagingSenderId: "776218080209",
      appId: "1:776218080209:web:9cdca09bfac704224766f0",
      authDomain: "devtalk-88046.firebaseapp.com",
      storageBucket: "devtalk-88046.firebasestorage.app",
    });
  });

  it("keeps each app ID consistent with its sender ID", () => {
    for (const [, binding] of recorded) expect(binding.appId.startsWith(`1:${binding.messagingSenderId}:web:`)).toBe(true);
  });

  it("contains no raw Firebase API key in its source", () => {
    const source = readFileSync(join(__dirname, "..", "web-config-bindings.ts"), "utf8");
    expect(source).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
  });

  it("pins a well-formed fingerprint, never a raw key", () => {
    for (const [, binding] of recorded) {
      expect(binding.apiKeySha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(binding)).not.toContain("apiKey");
    }
  });

  it("has no empty or padded fields", () => {
    for (const [, binding] of recorded) {
      for (const value of Object.values(binding)) {
        expect(value).toBe(value.trim());
        expect(value).not.toBe("");
      }
    }
  });
});

describe("assertWebProjectMatchesAdmin", () => {
  it("accepts a matching or absent browser project", () => {
    expect(() => assertWebProjectMatchesAdmin({ VITE_FIREBASE_PROJECT_ID: STAGING }, STAGING)).not.toThrow();
    expect(() => assertWebProjectMatchesAdmin({}, PROD)).not.toThrow();
  });

  it("refuses a browser project that differs from the Admin project, without echoing either", () => {
    const error = errorFrom(() => assertWebProjectMatchesAdmin({ VITE_FIREBASE_PROJECT_ID: STAGING }, PROD));
    expect(error.message).toBe("VITE_FIREBASE_PROJECT_ID does not match the Admin project.");
    expect(error.message).not.toContain(PROD);
    expect(error.message).not.toContain(STAGING);
  });
});
