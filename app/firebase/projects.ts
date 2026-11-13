/**
 * The Firebase projects this app may use, one per deployment environment.
 * Shared by the Admin SDK check (admin-project.server.ts) and the build-time
 * check of the browser config (vite.config.ts). Build and server only (it
 * uses node:crypto); no I/O. Bindings come from web-config-bindings.ts.
 *
 * A deployment says which environment it is in two independent ways:
 *   - DEVTALK_FIREBASE_ENV, set by us: "production" or "staging";
 *   - VERCEL_ENV, set by Vercel: production maps to "production",
 *     preview and development map to "staging".
 * When either is set, the configured project must be that environment's
 * project, and when both are set they must agree. With neither (local
 * development, tests), the project only has to be one of ours.
 * Errors name variables only, never their values.
 */
import { createHash } from "node:crypto";
import { WEB_CONFIG_BINDINGS, type WebConfigBinding } from "./web-config-bindings";

export type FirebaseEnvironment = "production" | "staging";

export const PRODUCTION_PROJECT_ID = "devtalk-88046";

/** The separate staging project ("DevTalk Staging") for Vercel Previews. */
export const STAGING_PROJECT_ID = "devtalk-staging";

/** null marks an environment with no project; its deployments are refused. */
export type FirebaseProjects = Readonly<Record<FirebaseEnvironment, string | null>>;

export const FIREBASE_PROJECTS: FirebaseProjects = {
  production: PRODUCTION_PROJECT_ID,
  staging: STAGING_PROJECT_ID,
};

export const DEPLOY_ENV_VAR = "DEVTALK_FIREBASE_ENV";

type Env = Partial<Record<string, string | undefined>>;

export class FirebaseProjectError extends Error {
  readonly code = "firebase/project-mismatch";
  constructor(message: string) {
    super(message);
    this.name = "FirebaseProjectError";
  }
}

const VERCEL_ENVIRONMENTS: Record<string, FirebaseEnvironment> = {
  production: "production",
  preview: "staging",
  development: "staging",
};

/** The environment this deployment declares, or null when it declares none. */
export function deploymentEnvironment(env: Env): FirebaseEnvironment | null {
  const declared = env[DEPLOY_ENV_VAR]?.trim();
  const vercel = env.VERCEL_ENV?.trim();

  let ours: FirebaseEnvironment | null = null;
  if (declared) {
    if (declared !== "production" && declared !== "staging") {
      throw new FirebaseProjectError(`${DEPLOY_ENV_VAR} must be "production" or "staging".`);
    }
    ours = declared;
  }

  let theirs: FirebaseEnvironment | null = null;
  if (vercel) {
    theirs = VERCEL_ENVIRONMENTS[vercel] ?? null;
    if (!theirs) throw new FirebaseProjectError("VERCEL_ENV has an unrecognized value.");
  }

  if (ours && theirs && ours !== theirs) {
    throw new FirebaseProjectError(`${DEPLOY_ENV_VAR} does not match VERCEL_ENV.`);
  }
  return ours ?? theirs;
}

/** Our configured projects, in a fixed order. */
export function knownProjectIds(projects: FirebaseProjects = FIREBASE_PROJECTS): string[] {
  return Object.values(projects).filter((id): id is string => id !== null);
}

/**
 * Checks that `projectId`, read from `variable`, is the right project for
 * this deployment. Returns it trimmed; throws FirebaseProjectError otherwise.
 */
export function assertProjectForDeployment(
  env: Env,
  variable: string,
  projectId: string,
  projects: FirebaseProjects = FIREBASE_PROJECTS
): string {
  const id = projectId.trim();
  const environment = deploymentEnvironment(env);
  if (environment) {
    const expected = projects[environment];
    if (expected === null) {
      throw new FirebaseProjectError(`No Firebase project is configured for ${environment} deployments.`);
    }
    if (id !== expected) {
      throw new FirebaseProjectError(`${variable} is not the ${environment} project.`);
    }
    return id;
  }
  if (!knownProjectIds(projects).includes(id)) {
    throw new FirebaseProjectError(`${variable} is not an allowed project for this deployment.`);
  }
  return id;
}

const WEB_PROJECT_VAR = "VITE_FIREBASE_PROJECT_ID";

const WEB_API_KEY_VAR = "VITE_FIREBASE_API_KEY";

/** The public web config fields compared as-is, and the build variable that supplies each. */
const WEB_CONFIG_VARS: readonly [Exclude<keyof WebConfigBinding, "apiKeySha256">, string][] = [
  ["projectId", WEB_PROJECT_VAR],
  ["appId", "VITE_FIREBASE_APP_ID"],
  ["messagingSenderId", "VITE_FIREBASE_MESSAGING_SENDER_ID"],
  ["authDomain", "VITE_FIREBASE_AUTH_DOMAIN"],
  ["storageBucket", "VITE_FIREBASE_STORAGE_BUCKET"],
];

const SHA256_HEX = /^[0-9a-f]{64}$/;

export type WebConfigBindings = Readonly<Record<FirebaseEnvironment, WebConfigBinding | null>>;

/** Lowercase hex SHA-256 of a UTF-8 string, as `printf '%s' "$KEY" | shasum -a 256` prints it. */
export const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * Build-time check of the browser Firebase config. Runs only when the
 * deployment declares an environment (DEVTALK_FIREBASE_ENV or VERCEL_ENV),
 * so local builds are unchanged. The environment's recorded binding
 * (web-config-bindings.ts) must exist and name that environment's project;
 * the API key's SHA-256 must equal the pinned fingerprint, and the app ID,
 * sender ID, auth domain, bucket and project must equal the recorded values.
 * Errors name variables only, never values or fingerprints.
 */
export function assertWebConfigForDeployment(
  env: Env,
  projects: FirebaseProjects = FIREBASE_PROJECTS,
  bindings: WebConfigBindings = WEB_CONFIG_BINDINGS
): void {
  const environment = deploymentEnvironment(env);
  if (environment === null) return;
  const projectId = env[WEB_PROJECT_VAR]?.trim();
  if (!projectId) throw new FirebaseProjectError(`${WEB_PROJECT_VAR} must be set.`);
  assertProjectForDeployment(env, WEB_PROJECT_VAR, projectId, projects);

  const binding = bindings[environment];
  if (!binding) {
    throw new FirebaseProjectError(`No verified web configuration is recorded for ${environment} deployments.`);
  }
  if (binding.projectId !== projects[environment]) {
    throw new FirebaseProjectError(`The recorded ${environment} web configuration names another project.`);
  }
  if (!SHA256_HEX.test(binding.apiKeySha256)) {
    throw new FirebaseProjectError(`The recorded ${environment} API key fingerprint is missing or malformed.`);
  }
  const apiKey = env[WEB_API_KEY_VAR]?.trim();
  if (!apiKey || sha256Hex(apiKey) !== binding.apiKeySha256) {
    throw new FirebaseProjectError(`${WEB_API_KEY_VAR} does not match the recorded ${environment} fingerprint.`);
  }
  for (const [field, variable] of WEB_CONFIG_VARS) {
    if (env[variable]?.trim() !== binding[field]) {
      throw new FirebaseProjectError(`${variable} does not match the recorded ${environment} web configuration.`);
    }
  }
}

/**
 * Runtime check that the browser config, when its variables are present in
 * the server's environment (they are on Vercel), names the same project as
 * the Admin SDK. The Admin SDK's verifyIdToken already rejects tokens from
 * another project; this makes the mismatch a configuration error up front.
 */
export function assertWebProjectMatchesAdmin(env: Env, adminProjectId: string): void {
  const webProject = env[WEB_PROJECT_VAR]?.trim();
  if (webProject && webProject !== adminProjectId) {
    throw new FirebaseProjectError(`${WEB_PROJECT_VAR} does not match the Admin project.`);
  }
}
