/**
 * @jest-environment node
 *
 * The staging seed's data and target checks. Nothing here loads
 * firebase-admin or talks to Firebase; the CLI cases all refuse before that.
 * The emulator end-to-end run is in tests/firestore-rules/staging-seed.test.ts.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { analysisCacheKey, ANALYSIS_VERSION } from "../../../app/api/analysis-cache.server";
import { selectForAnalysis, toTrustedComment } from "../../../app/api/analysis-comments";
import { validateAnalysisText } from "../../../app/api/analysis-output";
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from "../../../app/firebase/projects";
import { planSeed, SEED_ID, SYNTHETIC_LABEL, type SeedDocument, type TimestampMarker } from "../dataset";
import { assertKeyFileProject, assertSeedTarget, PRODUCTION_PROJECT, STAGING_PROJECT, UnsafeSeedTarget } from "../target";

const NOW = Date.UTC(2026, 5, 1, 12);
const plan = planSeed(NOW);
const byPath = (prefix: string) => plan.documents.filter((d) => d.path.startsWith(prefix));
const forum = (slug: string) => plan.documents.find((d) => d.path === `forums/seed-v1-${slug}`)!;

describe("planSeed", () => {
  it("reports its planned record counts", () => {
    expect(plan.counts).toEqual({ users: 3, forums: 8, comments: 9, analysisCache: 1, total: 21 });
    expect(byPath("forums/")).toHaveLength(8);
    expect(byPath("comments/")).toHaveLength(9);
    expect(byPath("analysisCache/")).toHaveLength(1);
  });

  it("marks every document and namespaces every ID", () => {
    for (const doc of plan.documents) {
      expect(doc.data.seed).toBe(SEED_ID);
      expect(doc.path.split("/")[1]).toMatch(/^seed-v1-/);
    }
    for (const user of plan.users) {
      expect(user.uid).toMatch(/^seed-v1-/);
      expect(user.email).toMatch(/@example\.test$/);
    }
    expect(new Set(plan.documents.map((d) => d.path)).size).toBe(plan.documents.length);
  });

  it("collects only the profile field the app saves (displayName) and no claims", () => {
    for (const user of plan.users) expect(Object.keys(user).sort()).toEqual(["displayName", "email", "uid"]);
  });

  it("covers every posting state and legacy date shape", () => {
    expect(forum("hidden").data.isActive).toBe(false);
    expect(forum("admin-deleted").data.isAdminDeleted).toBe(true);
    expect("endTime" in forum("no-end-time").data).toBe(false);
    expect((forum("open").data.endTime as TimestampMarker).$timestamp).toBeGreaterThan(NOW);
    expect((forum("expired").data.endTime as TimestampMarker).$timestamp).toBeLessThan(NOW);
    expect(typeof forum("legacy-dates").data.endTime).toBe("string");
    expect(forum("legacy-null-end").data.endTime).toBeNull();
    expect(typeof forum("legacy-number-end").data.endTime).toBe("number");
    const commentDates = byPath("comments/seed-v1-legacy-dates").map((c) => c.data.createdAt);
    expect(commentDates).toEqual(["2025-03-14T09:26:00Z", 1_710_000_000_000, null]);
  });

  it("keeps commentCount equal to the planned comments", () => {
    for (const f of byPath("forums/")) {
      const id = f.path.split("/")[1];
      expect(f.data.commentCount).toBe(byPath("comments/").filter((c) => c.data.forumId === id).length);
    }
  });

  it("is deterministic for a given time", () => {
    expect(planSeed(NOW)).toEqual(plan);
  });
});

describe("the synthetic cached analysis", () => {
  const cache = byPath("analysisCache/")[0];

  it("uses exactly the key the server computes for the open forum", () => {
    const f = forum("open");
    const forumId = f.path.split("/")[1];
    const toPlain = (doc: SeedDocument) => {
      const data = { ...doc.data } as Record<string, unknown>;
      const at = data.createdAt as TimestampMarker;
      data.createdAt = { toMillis: () => at.$timestamp };
      return toTrustedComment(doc.path.split("/")[1], data);
    };
    const comments = selectForAnalysis(byPath("comments/").filter((c) => c.data.forumId === forumId).map(toPlain));
    const context = { title: f.data.title as string, description: f.data.description as string, question: f.data.question as string, category: (f.data.tags as string[])[0] };
    expect(cache.path).toBe(`analysisCache/${analysisCacheKey(forumId, context, comments)}`);
    expect(cache.data.version).toBe(ANALYSIS_VERSION);
  });

  it("passes the server's validation and is labelled synthetic everywhere it is shown", () => {
    const analysis = validateAnalysisText(cache.data);
    expect(analysis).not.toBeNull();
    expect(analysis!.summary.startsWith(SYNTHETIC_LABEL)).toBe(true);
    for (const step of analysis!.actionRoadmap) expect(step.startsWith(SYNTHETIC_LABEL)).toBe(true);
    expect(cache.data.synthetic).toBe(true);
    expect(cache.data.model).not.toMatch(/gpt/i);
  });
});

describe("assertSeedTarget", () => {
  const EMULATORS = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };
  const STAGING_ENV = { DEVTALK_FIREBASE_ENV: "staging" };
  const message = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeSeedTarget);
      return (error as Error).message;
    }
    throw new Error("expected a refusal");
  };

  it("matches the app's project constants", () => {
    expect(STAGING_PROJECT).toBe(STAGING_PROJECT_ID);
    expect(PRODUCTION_PROJECT).toBe(PRODUCTION_PROJECT_ID);
  });

  it("accepts the emulators with a demo project", () => {
    expect(assertSeedTarget("emulator", EMULATORS, { project: "demo-devtalk" })).toEqual({
      kind: "emulator",
      projectId: "demo-devtalk",
      firestoreHost: "127.0.0.1:8080",
      authHost: "127.0.0.1:9099",
    });
  });

  it("accepts devtalk-staging with confirmation, by ADC or a staging service account", () => {
    expect(assertSeedTarget("staging", STAGING_ENV, { project: STAGING_PROJECT, confirm: STAGING_PROJECT })).toEqual({
      kind: "staging",
      projectId: STAGING_PROJECT,
      credential: "adc",
    });
    const sa = { ...STAGING_ENV, FIREBASE_ADMIN_CLIENT_EMAIL: "seed@devtalk-staging.iam.gserviceaccount.com", FIREBASE_ADMIN_PRIVATE_KEY: "FAKE" };
    expect(assertSeedTarget("staging", sa, { project: STAGING_PROJECT, confirm: STAGING_PROJECT }).kind).toBe("staging");
  });

  it.each([
    ["the production project as target", "staging", STAGING_ENV, { project: PRODUCTION_PROJECT, confirm: PRODUCTION_PROJECT }],
    ["the production project on the emulator", "emulator", EMULATORS, { project: PRODUCTION_PROJECT }],
    ["staging without confirmation", "staging", STAGING_ENV, { project: STAGING_PROJECT }],
    ["staging with the wrong confirmation", "staging", STAGING_ENV, { project: STAGING_PROJECT, confirm: "yes" }],
    ["staging without DEVTALK_FIREBASE_ENV", "staging", {}, { project: STAGING_PROJECT, confirm: STAGING_PROJECT }],
    ["staging with emulator hosts set", "staging", { ...STAGING_ENV, ...EMULATORS }, { project: STAGING_PROJECT, confirm: STAGING_PROJECT }],
    ["staging with a production service account", "staging",
      { ...STAGING_ENV, FIREBASE_ADMIN_CLIENT_EMAIL: "x@other.iam.gserviceaccount.com", FIREBASE_ADMIN_PRIVATE_KEY: "FAKE" },
      { project: STAGING_PROJECT, confirm: STAGING_PROJECT }],
    ["staging with half a service account", "staging", { ...STAGING_ENV, FIREBASE_ADMIN_PRIVATE_KEY: "FAKE" }, { project: STAGING_PROJECT, confirm: STAGING_PROJECT }],
    ["staging with another GOOGLE_CLOUD_PROJECT", "staging", { ...STAGING_ENV, GOOGLE_CLOUD_PROJECT: "something-else" }, { project: STAGING_PROJECT, confirm: STAGING_PROJECT }],
    ["staging in a production Vercel env", "staging", { ...STAGING_ENV, VERCEL_ENV: "production" }, { project: STAGING_PROJECT, confirm: STAGING_PROJECT }],
    ["any variable naming production", "staging", { ...STAGING_ENV, SOME_VAR: "projects/devtalk-88046/x" }, { project: STAGING_PROJECT, confirm: STAGING_PROJECT }],
    ["production web config on the emulator", "emulator", { ...EMULATORS, VITE_FIREBASE_PROJECT_ID: PRODUCTION_PROJECT }, { project: "demo-devtalk" }],
    ["a non-loopback emulator", "emulator", { ...EMULATORS, FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" }, { project: "demo-devtalk" }],
    ["a missing auth emulator", "emulator", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, { project: "demo-devtalk" }],
    ["credentials on the emulator", "emulator", { ...EMULATORS, GOOGLE_APPLICATION_CREDENTIALS: "/k.json" }, { project: "demo-devtalk" }],
    ["a non-demo emulator project", "emulator", EMULATORS, { project: STAGING_PROJECT }],
    ["an unknown target", "production", EMULATORS, { project: "demo-devtalk" }],
  ])("refuses %s", (_label, kind, env, args) => {
    const text = message(() => assertSeedTarget(kind, env as Record<string, string>, args));
    expect(text).not.toContain("FAKE");
  });

  it("checks a key file's project", () => {
    expect(() => assertKeyFileProject(JSON.stringify({ project_id: STAGING_PROJECT }), STAGING_PROJECT)).not.toThrow();
    expect(() => assertKeyFileProject(JSON.stringify({ type: "authorized_user" }), STAGING_PROJECT)).not.toThrow();
    expect(() => assertKeyFileProject(JSON.stringify({ project_id: PRODUCTION_PROJECT }), STAGING_PROJECT)).toThrow(UnsafeSeedTarget);
    expect(() => assertKeyFileProject("not json", STAGING_PROJECT)).toThrow(UnsafeSeedTarget);
  });
});

describe("cli.mjs", () => {
  const CLI = join(__dirname, "..", "cli.mjs");
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });

  it("plans without connecting", () => {
    const result = run(["plan", "--target", "staging", "--project", STAGING_PROJECT, "--confirm", STAGING_PROJECT], { DEVTALK_FIREBASE_ENV: "staging" });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.planned).toEqual(plan.counts);
    expect(report.writesPerformed).toBe(0);
  });

  it.each([
    ["no command", []],
    ["an unknown flag", ["apply", "--target", "emulator", "--project", "demo-devtalk", "--force", "x"]],
    ["the production project", ["apply", "--target", "staging", "--project", PRODUCTION_PROJECT, "--confirm", PRODUCTION_PROJECT, "--credentials-out", "/tmp/x"]],
    ["apply without a credentials file", ["apply", "--target", "emulator", "--project", "demo-devtalk"]],
    ["a credentials file inside the repository", ["apply", "--target", "emulator", "--project", "demo-devtalk", "--credentials-out", join(__dirname, "creds.json")]],
  ])("refuses %s (exit 2) before connecting", (_label, args) => {
    const result = run(args, { FIRESTORE_EMULATOR_HOST: "127.0.0.1:1", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:1", DEVTALK_FIREBASE_ENV: "staging" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Refusing to run");
  });
});
