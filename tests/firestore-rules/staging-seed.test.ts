/**
 * The synthetic staging seed against the Auth and Firestore emulators (demo
 * project, real Admin SDK, real rules): apply, idempotent re-apply, verify,
 * what signed-in seed users can read, the server's cache lookup, conflict
 * refusal, and cleanup that touches only this seed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { doc, getDoc, getDocs } from "firebase/firestore";
import { analysisCacheKey, readCachedAnalysis } from "../../app/api/analysis-cache.server";
import { selectForAnalysis, toTrustedComment } from "../../app/api/analysis-comments";
import { listedForumsQuery } from "../../app/hooks/forum-data";
import { planSeed, SEED_ID, SYNTHETIC_LABEL } from "../../scripts/staging-seed/dataset";
import { applySeed, cleanupSeed, SeedConflict, verifySeed, type SeedAuth, type SeedHandles } from "../../scripts/staging-seed/seed";
import { asDb, PROJECT_ID, startRulesEnv } from "./setup";

const plan = planSeed(Date.now());
let env: RulesTestEnvironment;
let app: App;
let db: Firestore;
let auth: EmulatorAuth;
let handles: SeedHandles;
let n = 0;
const passwords = () => `test-password-${++n}`;

const authHost = () => {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) throw new Error("Run with `npm run test:rules` (starts the Auth and Firestore emulators).");
  return host;
};

async function clearAuth() {
  const res = await fetch(`http://${authHost()}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  expect(res.ok).toBe(true);
}

/**
 * The Admin Auth calls the seed makes, over the Auth emulator's REST API.
 * (firebase-admin/auth loads ESM-only dependencies that this Jest setup
 * cannot import; the CLI rehearsal exercises the real Admin Auth client.)
 */
type EmulatorUser = { uid: string; email?: string; displayName?: string; customClaims?: Record<string, unknown> };
type EmulatorAuth = SeedAuth & { getUser(uid: string): Promise<EmulatorUser> };

function emulatorAuth(): EmulatorAuth {
  const base = () => `http://${authHost()}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;
  const call = async (path: string, body: unknown) => {
    const res = await fetch(`${base()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw Object.assign(new Error(`auth emulator ${path} ${res.status}`), { code: "auth/emulator-error" });
    return (await res.json()) as Record<string, unknown>;
  };
  const lookup = async (query: Record<string, string[]>) => {
    const users = (await call("/accounts:lookup", query)).users as Record<string, unknown>[] | undefined;
    const u = users?.[0];
    if (!u) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
    const claims = typeof u.customAttributes === "string" ? JSON.parse(u.customAttributes) : undefined;
    return { uid: u.localId as string, email: u.email as string | undefined, displayName: u.displayName as string | undefined, customClaims: claims };
  };
  return {
    getUser: (uid: string) => lookup({ localId: [uid] }),
    getUserByEmail: (email: string) => lookup({ email: [email] }),
    createUser: async (props: { uid?: string; email?: string; password?: string; displayName?: string }) => {
      await call("/accounts", { localId: props.uid, email: props.email, password: props.password, displayName: props.displayName });
      return lookup({ localId: [props.uid!] });
    },
    deleteUser: async (uid: string) => {
      await call("/accounts:delete", { localId: uid });
    },
  } as unknown as EmulatorAuth;
}

/** Signs in through the Auth emulator's REST API, as the browser SDK would. */
async function signIn(email: string, password: string) {
  const res = await fetch(`http://${authHost()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-emulator-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string; localId?: string };
  // The claims the server reads (displayNameFor uses the token's name claim)
  const claims = body.idToken ? JSON.parse(Buffer.from(body.idToken.split(".")[1], "base64url").toString()) : {};
  return { ok: res.ok, uid: body.localId, claims: claims as { name?: string; admin?: unknown } };
}

beforeAll(async () => {
  authHost();
  env = await startRulesEnv();
  app = initializeApp({ projectId: PROJECT_ID }, "staging-seed-test");
  db = getFirestore(app);
  auth = emulatorAuth();
  handles = { db, auth, timestampFromMillis: (ms) => Timestamp.fromMillis(ms), guard: () => undefined };
});
afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await clearAuth();
});

describe("staging seed on the emulators", () => {
  it("applies once, then re-applies without changes", async () => {
    const first = await applySeed(plan, handles, passwords);
    expect(first.users).toEqual({ created: 3, existing: 0 });
    expect(first.documents).toEqual({ created: 18, existing: 0 });
    expect(first.newCredentials.map((c) => c.email)).toEqual(plan.users.map((u) => u.email));

    const before = await db.doc("forums/seed-v1-open").get();
    const second = await applySeed(plan, handles, passwords);
    expect(second.users).toEqual({ created: 0, existing: 3 });
    expect(second.documents).toEqual({ created: 0, existing: 18 });
    expect(second.newCredentials).toEqual([]);
    expect((await db.doc("forums/seed-v1-open").get()).updateTime?.isEqual(before.updateTime!)).toBe(true);

    expect(await verifySeed(plan, handles)).toEqual({
      record: "applied",
      documents: { missing: 0, seeded: 18, foreign: 0 },
      users: { missing: 0, seeded: 3, foreign: 0 },
      foreign: [],
    });
    const record = await db.doc(`stagingSeed/${SEED_ID}`).get();
    expect(record.get("paths")).toEqual(plan.documents.map((d) => d.path));
  });

  it("creates accounts that sign in with their display name and no admin claim", async () => {
    const { newCredentials } = await applySeed(plan, handles, passwords);
    for (const user of plan.users) {
      const password = newCredentials.find((c) => c.email === user.email)!.password;
      const result = await signIn(user.email, password);
      expect(result.ok).toBe(true);
      expect(result.uid).toBe(user.uid);
      expect(result.claims.name).toBe(user.displayName);
      expect(result.claims.admin).toBeUndefined();
      expect((await auth.getUser(user.uid)).displayName).toBe(user.displayName);
      expect((await auth.getUser(user.uid)).customClaims ?? {}).toEqual({});
    }
  });

  it("stores the states the rules and the forum page depend on", async () => {
    await applySeed(plan, handles, passwords);
    const as = (uid: string) => asDb(env.authenticatedContext(uid).firestore());
    const bob = as("seed-v1-bob");
    const alice = as("seed-v1-alice");

    const listed = (await assertSucceeds(getDocs(listedForumsQuery(bob)))).docs.map((d) => d.id).sort();
    expect(listed).toEqual(
      ["seed-v1-expired", "seed-v1-legacy-dates", "seed-v1-legacy-null-end", "seed-v1-legacy-number-end", "seed-v1-no-end-time", "seed-v1-open"].sort()
    );
    await assertFails(getDoc(doc(bob, "forums/seed-v1-hidden")));
    await assertSucceeds(getDoc(doc(alice, "forums/seed-v1-hidden")));
    await assertFails(getDoc(doc(alice, "forums/seed-v1-admin-deleted")));
    await assertFails(getDoc(doc(bob, "forums/seed-v1-admin-deleted")));
    await assertFails(getDoc(doc(bob, `stagingSeed/${SEED_ID}`)));

    const open = await db.doc("forums/seed-v1-open").get();
    expect(open.get("endTime")).toBeInstanceOf(Timestamp);
    expect(typeof (await db.doc("forums/seed-v1-legacy-dates").get()).get("endTime")).toBe("string");
  });

  it("serves the synthetic cached analysis through the server's own lookup", async () => {
    await applySeed(plan, handles, passwords);
    const forum = (await db.doc("forums/seed-v1-open").get()).data()!;
    const snap = await db.collection("comments").where("forumId", "==", "seed-v1-open").get();
    const comments = selectForAnalysis(snap.docs.map((d) => toTrustedComment(d.id, d.data())));
    const context = { title: forum.title, description: forum.description, question: forum.question, category: forum.tags[0] };
    const cached = await readCachedAnalysis(db, analysisCacheKey("seed-v1-open", context, comments), "seed-v1-open");
    expect(cached.status).toBe("hit");
    if (cached.status === "hit") expect(cached.analysis.summary.startsWith(SYNTHETIC_LABEL)).toBe(true);
  });

  it("refuses before any write when a planned record belongs to someone else", async () => {
    await db.doc("forums/seed-v1-open").set({ title: "not the seed's" });
    await expect(applySeed(plan, handles, passwords)).rejects.toThrow(SeedConflict);
    expect((await db.doc(`stagingSeed/${SEED_ID}`).get()).exists).toBe(false);
    expect((await db.collection("forums").get()).size).toBe(1);
    await expect(auth.getUser("seed-v1-alice")).rejects.toMatchObject({ code: "auth/user-not-found" });

    await env.clearFirestore();
    await auth.createUser({ uid: "someone-else", email: "seed-bob@example.test" });
    await expect(applySeed(plan, handles, passwords)).rejects.toThrow("auth/seed-v1-bob");
    expect((await db.collection("forums").get()).size).toBe(0);
  });

  it("cleans up only this seed's records", async () => {
    await applySeed(plan, handles, passwords);
    await db.doc("forums/real-forum").set({ title: "Not seeded" });
    await auth.createUser({ uid: "real-user", email: "real@example.test" });
    await db.doc("comments/seed-v1-open-c1").update({ seed: "someone-else" }); // ownership changed after seeding

    const removed = await cleanupSeed(plan, handles);
    expect(removed).toEqual({ documents: 17, users: 3, skipped: ["comments/seed-v1-open-c1"] });
    expect((await db.doc("forums/real-forum").get()).exists).toBe(true);
    expect((await db.doc("comments/seed-v1-open-c1").get()).exists).toBe(true);
    expect((await auth.getUser("real-user")).email).toBe("real@example.test");
    // The record stays while something it listed was skipped
    expect((await db.doc(`stagingSeed/${SEED_ID}`).get()).exists).toBe(true);

    const verify = await verifySeed(plan, handles);
    expect(verify.documents).toEqual({ missing: 17, seeded: 0, foreign: 1 });
    expect(verify.users).toEqual({ missing: 3, seeded: 0, foreign: 0 });
  });
});
