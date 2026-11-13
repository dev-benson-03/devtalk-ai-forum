/**
 * The synthetic staging seed against the Auth and Firestore emulators (demo
 * project, real Admin SDK, real rules): apply, idempotent re-apply, verify,
 * what signed-in seed users can read, the server's cache lookup, conflict
 * refusal, cleanup that touches only what the seed provably created, and
 * recovery from interrupted runs with the private credentials file.
 * Passwords are generated into temporary files; nothing real is used.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { doc, getDoc, getDocs } from "firebase/firestore";
import { analysisCacheKey, readCachedAnalysis } from "../../app/api/analysis-cache.server";
import { selectForAnalysis, toTrustedComment } from "../../app/api/analysis-comments";
import { listedForumsQuery } from "../../app/hooks/forum-data";
import { planSeed, SEED_ID, SYNTHETIC_LABEL } from "../../scripts/staging-seed/dataset";
import { CredentialsFileError, openCredentialsFile, type CredentialsFileStore, type FileOps } from "../../scripts/staging-seed/credentials";
import { applySeed, cleanupSeed, planDigest, SeedConflict, verifySeed, type SeedAuth, type SeedHandles } from "../../scripts/staging-seed/seed";
import { asDb, PROJECT_ID, startRulesEnv } from "./setup";

const plan = planSeed(Date.now());
let env: RulesTestEnvironment;
let app: App;
let db: Firestore;
let auth: EmulatorAuth;
let handles: SeedHandles;
let dir: string;
const TARGET = { kind: "emulator", projectId: PROJECT_ID };
const REPO = join(__dirname, "..", "..");
const RECORD = `stagingSeed/${SEED_ID}`;
const [alice, bob, carol] = plan.users;

/**
 * A new credentials file (resume: false) or the existing one (resume: true),
 * as the CLI opens it. Each call stands for a new run, so the previous run's
 * store is closed first (releasing its writer lock).
 */
let currentStore: CredentialsFileStore | undefined;
const credentials = (resume = false, fsOps?: FileOps, name = "creds.json") => {
  currentStore?.close();
  currentStore = openCredentialsFile(
    join(dir, name),
    { seed: plan.seed, target: TARGET, planDigest: planDigest(plan), users: plan.users },
    { resume, repoRoot: REPO, fs: fsOps }
  );
  return currentStore;
};
type SavedEntry = { email: string; password: string; status: string; runId: string };
const saved = (): Record<string, SavedEntry> => JSON.parse(fs.readFileSync(join(dir, "creds.json"), "utf8")).accounts;
const ledger = async () => (await db.doc(RECORD).get()).data();
const seedDocCount = async () => (await Promise.all(["forums", "comments", "analysisCache"].map((c) => db.collection(c).get()))).reduce((n, s) => n + s.size, 0);
const accountExists = async (uid: string) => auth.getUser(uid).then(() => true, () => false);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
type EmulatorUser = { uid: string; email?: string; displayName?: string; customClaims?: Record<string, unknown>; metadata: { creationTime: string } };
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
    // As the Admin SDK reports it: a UTC date string, to the second
    const creationTime = new Date(Number(u.createdAt)).toUTCString();
    return { uid: u.localId as string, email: u.email as string | undefined, displayName: u.displayName as string | undefined, customClaims: claims, metadata: { creationTime } };
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
  handles = { db, auth, timestampFromMillis: (ms) => Timestamp.fromMillis(ms), guard: () => undefined, target: TARGET };
});
afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await clearAuth();
  dir = fs.mkdtempSync(join(tmpdir(), "seed-emulator-"));
});
afterEach(() => {
  currentStore?.close();
  currentStore = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Handles whose Firestore fails the nth transaction (ledger updates use transactions). */
function failingTransaction(nth: number): SeedHandles {
  let calls = 0;
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "runTransaction") {
        return (...args: Parameters<Firestore["runTransaction"]>) => {
          if (++calls === nth) return Promise.reject(Object.assign(new Error("simulated Firestore outage"), { code: 14 }));
          return target.runTransaction(...args);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...handles, db: proxy };
}

/** Handles whose Firestore refuses to create one document. */
function failingCreate(path: string): SeedHandles {
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "doc") {
        return (p: string) => {
          const ref = target.doc(p);
          if (p !== path) return ref;
          return new Proxy(ref, {
            get(r, k) {
              if (k === "create") return () => Promise.reject(Object.assign(new Error("simulated write failure"), { code: 14 }));
              const value = Reflect.get(r, k, r);
              return typeof value === "function" ? value.bind(r) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...handles, db: proxy };
}

/** Handles whose Auth misbehaves on createUser for one uid. */
function createUserFor(uid: string, mode: "fails" | "lost-acknowledgement"): SeedHandles {
  const wrapped = {
    ...auth,
    getUser: auth.getUser,
    getUserByEmail: auth.getUserByEmail,
    deleteUser: auth.deleteUser,
    createUser: async (props: { uid?: string }) => {
      if (props.uid !== uid) return auth.createUser(props as never);
      if (mode === "lost-acknowledgement") await auth.createUser(props as never); // created, but the reply never arrives
      throw Object.assign(new Error("simulated network failure"), { code: "auth/internal-error" });
    },
  } as unknown as SeedAuth;
  return { ...handles, auth: wrapped };
}

/** File operations whose writes, after the first `skip` calls, report no progress. */
function noProgressAfter(skip: number): FileOps {
  let calls = 0;
  return {
    ...fs,
    writeSync: ((fd: number, data: Buffer, offset?: number, length?: number) =>
      ++calls > skip ? 0 : fs.writeSync(fd, data, offset ?? 0, length ?? data.length - (offset ?? 0))) as unknown as FileOps["writeSync"],
  };
}

/** File operations whose writes, after the first `skip` calls, write a few bytes once and then fail. */
function shortThenErrorAfter(skip: number): FileOps {
  let calls = 0;
  return {
    ...fs,
    writeSync: ((fd: number, data: Buffer, offset?: number, length?: number) => {
      calls++;
      if (calls <= skip) return fs.writeSync(fd, data, offset ?? 0, length ?? data.length - (offset ?? 0));
      if (calls === skip + 1) return fs.writeSync(fd, data, offset ?? 0, 5);
      throw Object.assign(new Error("simulated ENOSPC"), { code: "ENOSPC" });
    }) as unknown as FileOps["writeSync"],
  };
}

/** File operations whose nth rename (each credentials-file update) fails. */
function failingRename(nth: number): FileOps {
  let calls = 0;
  return {
    ...fs,
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (++calls === nth) throw Object.assign(new Error("simulated disk failure"), { code: "EIO" });
      fs.renameSync(from, to);
    },
  };
}

describe("staging seed on the emulators", () => {
  it("applies once, then re-applies without changes", async () => {
    const store = credentials();
    const first = await applySeed(plan, handles, store);
    expect(first.users).toEqual({ created: 3, existing: 0 });
    expect(first.documents).toEqual({ created: 18, existing: 0 });
    expect(first.createdUids).toEqual(plan.users.map((u) => u.uid));
    expect(store.summary()).toMatchObject({ created: 3, pending: 0, generatedThisRun: 3 });

    const before = await db.doc("forums/seed-v1-open").get();
    const passwords = saved();
    const second = await applySeed(plan, handles, credentials(true));
    expect(second.users).toEqual({ created: 0, existing: 3 });
    expect(second.documents).toEqual({ created: 0, existing: 18 });
    expect(second.createdUids).toEqual([]);
    expect(saved()).toEqual(passwords);
    expect((await db.doc("forums/seed-v1-open").get()).updateTime?.isEqual(before.updateTime!)).toBe(true);

    expect(await verifySeed(plan, handles)).toEqual({
      record: "applied",
      documents: { missing: 0, seeded: 18, foreign: 0 },
      users: { missing: 0, seeded: 3, foreign: 0, uncertain: 0 },
      foreign: [],
      uncertain: [],
    });
    const record = await ledger();
    expect(record?.paths).toEqual(plan.documents.map((d) => d.path));
    expect(record?.target).toEqual(TARGET);
    expect(record?.planDigest).toBe(planDigest(plan));
    for (const user of plan.users) {
      expect(record?.accounts[user.uid]).toEqual({
        email: user.email,
        credentialsId: store.id,
        state: "created",
        creationTime: (await auth.getUser(user.uid)).metadata.creationTime,
      });
    }
  });

  it("keeps passwords out of Firestore", async () => {
    await applySeed(plan, handles, credentials());
    const everything = JSON.stringify(
      await Promise.all(["forums", "comments", "analysisCache", "stagingSeed"].map(async (c) => (await db.collection(c).get()).docs.map((d) => d.data())))
    );
    for (const entry of Object.values(saved())) expect(everything).not.toContain(entry.password);
  });

  it("creates accounts that sign in with their saved password, display name and no admin claim", async () => {
    await applySeed(plan, handles, credentials());
    const passwords = saved();
    for (const user of plan.users) {
      expect(passwords[user.uid]).toMatchObject({ email: user.email, status: "created" });
      const result = await signIn(user.email, passwords[user.uid].password);
      expect(result.ok).toBe(true);
      expect(result.uid).toBe(user.uid);
      expect(result.claims.name).toBe(user.displayName);
      expect(result.claims.admin).toBeUndefined();
      expect((await auth.getUser(user.uid)).displayName).toBe(user.displayName);
      expect((await auth.getUser(user.uid)).customClaims ?? {}).toEqual({});
    }
  });

  it("stores the states the rules and the forum page depend on", async () => {
    await applySeed(plan, handles, credentials());
    const as = (uid: string) => asDb(env.authenticatedContext(uid).firestore());
    const bobDb = as("seed-v1-bob");
    const aliceDb = as("seed-v1-alice");

    const listed = (await assertSucceeds(getDocs(listedForumsQuery(bobDb)))).docs.map((d) => d.id).sort();
    expect(listed).toEqual(
      ["seed-v1-expired", "seed-v1-legacy-dates", "seed-v1-legacy-null-end", "seed-v1-legacy-number-end", "seed-v1-no-end-time", "seed-v1-open"].sort()
    );
    await assertFails(getDoc(doc(bobDb, "forums/seed-v1-hidden")));
    await assertSucceeds(getDoc(doc(aliceDb, "forums/seed-v1-hidden")));
    await assertFails(getDoc(doc(aliceDb, "forums/seed-v1-admin-deleted")));
    await assertFails(getDoc(doc(bobDb, "forums/seed-v1-admin-deleted")));
    await assertFails(getDoc(doc(bobDb, RECORD)));

    const open = await db.doc("forums/seed-v1-open").get();
    expect(open.get("endTime")).toBeInstanceOf(Timestamp);
    expect(typeof (await db.doc("forums/seed-v1-legacy-dates").get()).get("endTime")).toBe("string");
  });

  it("serves the synthetic cached analysis through the server's own lookup", async () => {
    await applySeed(plan, handles, credentials());
    const forum = (await db.doc("forums/seed-v1-open").get()).data()!;
    const snap = await db.collection("comments").where("forumId", "==", "seed-v1-open").get();
    const comments = selectForAnalysis(snap.docs.map((d) => toTrustedComment(d.id, d.data())));
    const context = { title: forum.title, description: forum.description, question: forum.question, category: forum.tags[0] };
    const cached = await readCachedAnalysis(db, analysisCacheKey("seed-v1-open", context, comments), "seed-v1-open");
    expect(cached.status).toBe("hit");
    if (cached.status === "hit") expect(cached.analysis.summary.startsWith(SYNTHETIC_LABEL)).toBe(true);
  });

  it("refuses before any write when a planned document belongs to someone else", async () => {
    await db.doc("forums/seed-v1-open").set({ title: "not the seed's" });
    await expect(applySeed(plan, handles, credentials())).rejects.toThrow(SeedConflict);
    expect((await db.doc(RECORD).get()).exists).toBe(false);
    expect((await db.collection("forums").get()).size).toBe(1);
    expect(await accountExists(alice.uid)).toBe(false);
    expect(saved()).toEqual({});
  });

  it("cleans up only this seed's records", async () => {
    await applySeed(plan, handles, credentials());
    await db.doc("forums/real-forum").set({ title: "Not seeded" });
    await auth.createUser({ uid: "real-user", email: "real@example.test" });
    await db.doc("comments/seed-v1-open-c1").update({ seed: "someone-else" }); // ownership changed after seeding

    const removed = await cleanupSeed(plan, handles);
    expect(removed).toEqual({ documents: 17, users: 3, skipped: ["comments/seed-v1-open-c1"] });
    expect((await db.doc("forums/real-forum").get()).exists).toBe(true);
    expect((await db.doc("comments/seed-v1-open-c1").get()).exists).toBe(true);
    expect((await auth.getUser("real-user")).email).toBe("real@example.test");
    // The record stays while something it listed was skipped
    expect((await db.doc(RECORD).get()).exists).toBe(true);

    const verify = await verifySeed(plan, handles);
    expect(verify.documents).toEqual({ missing: 17, seeded: 0, foreign: 1 });
    expect(verify.users).toEqual({ missing: 3, seeded: 0, foreign: 0, uncertain: 0 });
  });

  it("cleans up completely, and a repeated cleanup changes nothing", async () => {
    await applySeed(plan, handles, credentials());
    expect(await cleanupSeed(plan, handles)).toEqual({ documents: 18, users: 3, skipped: [] });
    expect((await db.doc(RECORD).get()).exists).toBe(false);
    expect(await seedDocCount()).toBe(0);
    expect(await cleanupSeed(plan, handles)).toEqual({ documents: 0, users: 0, skipped: [] });
  });

  it("re-applies after cleanup with the same saved passwords", async () => {
    await applySeed(plan, handles, credentials());
    const passwords = saved();
    await cleanupSeed(plan, handles);
    const again = await applySeed(plan, handles, credentials(true));
    expect(again.users).toEqual({ created: 3, existing: 0 });
    for (const user of plan.users) {
      expect(saved()[user.uid]).toMatchObject({ password: passwords[user.uid].password, status: "created" });
      expect((await signIn(user.email, passwords[user.uid].password)).ok).toBe(true);
    }
  });
});

describe("account ownership", () => {
  it("never adopts a pre-existing account with the planned uid and email, and cleanup preserves it", async () => {
    await auth.createUser({ uid: alice.uid, email: alice.email, password: "someone-elses-password" } as never);

    await expect(applySeed(plan, handles, credentials())).rejects.toThrow(`auth/${alice.uid}`);
    expect((await db.doc(RECORD).get()).exists).toBe(false);
    expect(await seedDocCount()).toBe(0);
    expect(await accountExists(bob.uid)).toBe(false);
    expect(saved()).toEqual({});
    expect((await signIn(alice.email, "someone-elses-password")).ok).toBe(true); // password untouched

    expect((await verifySeed(plan, handles)).foreign).toEqual([`auth/${alice.uid}`]);
    expect(await cleanupSeed(plan, handles)).toEqual({ documents: 0, users: 0, skipped: [`auth/${alice.uid} (foreign)`] });
    expect(await accountExists(alice.uid)).toBe(true);
  });

  it("treats an account under the planned email but another uid as foreign", async () => {
    await auth.createUser({ uid: "someone-else", email: bob.email });
    await expect(applySeed(plan, handles, credentials())).rejects.toThrow(`auth/${bob.uid}`);
    expect(await seedDocCount()).toBe(0);
    expect(await cleanupSeed(plan, handles)).toMatchObject({ users: 0, skipped: [`auth/${bob.uid} (foreign)`] });
    expect(await accountExists("someone-else")).toBe(true);
  });

  it("preserves a matching account the ledger does not list, even when the ledger is otherwise valid", async () => {
    await applySeed(plan, handles, credentials());
    await auth.deleteUser(carol.uid);
    const { [carol.uid]: _removed, ...others } = (await ledger())!.accounts;
    await db.doc(RECORD).update({ accounts: others }); // as if the seed had never created carol
    await auth.createUser({ uid: carol.uid, email: carol.email });

    const removed = await cleanupSeed(plan, handles);
    expect(removed.users).toBe(2);
    expect(removed.skipped).toEqual([`auth/${carol.uid} (foreign)`]);
    expect(await accountExists(carol.uid)).toBe(true);
    expect((await db.doc(RECORD).get()).exists).toBe(true);
  });

  it.each([
    ["another target", { target: { kind: "staging", projectId: "devtalk-staging" } }],
    ["another seed", { seed: "staging-seed-v0" }],
    ["another plan", { planDigest: "0".repeat(64) }],
    ["an unplanned account", { accounts: { "real-user": { email: "real@example.test", credentialsId: "x", state: "created", creationTime: "Mon, 01 Jun 2026 12:00:00 GMT" } } }],
    ["a mismatched email", { accounts: { "seed-v1-alice": { email: "real@example.test", credentialsId: "x", state: "created", creationTime: "Mon, 01 Jun 2026 12:00:00 GMT" } } }],
    ["an unknown state", { accounts: { "seed-v1-alice": { email: "seed-alice@example.test", credentialsId: "x", state: "adopted" } } }],
  ])("refuses a ledger for %s: apply writes nothing and cleanup deletes nothing", async (_label, change) => {
    await applySeed(plan, handles, credentials());
    await db.doc(RECORD).update(change);
    const before = await ledger();

    await expect(applySeed(plan, handles, credentials(true))).rejects.toThrow("does not belong to this run");
    await expect(cleanupSeed(plan, handles)).rejects.toThrow("does not belong to this run");
    expect(await ledger()).toEqual(before);
    expect(await seedDocCount()).toBe(18);
    for (const user of plan.users) expect(await accountExists(user.uid)).toBe(true);
    expect((await verifySeed(plan, handles)).record).toBe("invalid");
  });

  it("ignores extra paths in the ledger: cleanup acts on the plan only", async () => {
    await applySeed(plan, handles, credentials());
    await db.doc("forums/real-forum").set({ title: "Not seeded", seed: SEED_ID }); // even one that claims the marker
    await db.doc(RECORD).update({ paths: [...plan.documents.map((d) => d.path), "forums/real-forum"] });
    await cleanupSeed(plan, handles);
    expect((await db.doc("forums/real-forum").get()).exists).toBe(true);
  });

  it("does not treat an account deleted and recreated with the same uid and email as the seed's", async () => {
    await applySeed(plan, handles, credentials());
    await sleep(1100); // creationTime has one-second resolution
    await auth.deleteUser(alice.uid);
    await auth.createUser({ uid: alice.uid, email: alice.email, password: "a-new-owners-password" } as never);

    const verify = await verifySeed(plan, handles);
    expect(verify.users).toEqual({ missing: 0, seeded: 2, foreign: 1, uncertain: 0 });
    await expect(applySeed(plan, handles, credentials(true))).rejects.toThrow(`auth/${alice.uid}`);

    const removed = await cleanupSeed(plan, handles);
    expect(removed).toEqual({ documents: 18, users: 2, skipped: [`auth/${alice.uid} (foreign)`] });
    expect((await signIn(alice.email, "a-new-owners-password")).ok).toBe(true);
    expect((await db.doc(RECORD).get()).exists).toBe(true);
  });
});

describe("interrupted applies and recovery", () => {
  it("resumes after a failure following the first account, without generating a password twice", async () => {
    await expect(applySeed(plan, createUserFor(bob.uid, "fails"), credentials())).rejects.toThrow("simulated network failure");
    const afterFailure = saved();
    expect(afterFailure[alice.uid].status).toBe("created");
    expect(afterFailure[bob.uid].status).toBe("pending"); // saved before the attempt
    expect(afterFailure[carol.uid]).toBeUndefined();
    expect(await accountExists(bob.uid)).toBe(false);
    expect(await seedDocCount()).toBe(0);
    expect((await verifySeed(plan, handles)).users).toEqual({ missing: 2, seeded: 1, foreign: 0, uncertain: 0 });

    const store = credentials(true);
    const resumed = await applySeed(plan, handles, store);
    expect(resumed.users).toEqual({ created: 2, existing: 1 });
    expect(resumed.documents).toEqual({ created: 18, existing: 0 });
    expect(store.summary()).toMatchObject({ created: 3, pending: 0, generatedThisRun: 1 }); // only carol's is new
    const final = saved();
    expect(final[alice.uid].password).toBe(afterFailure[alice.uid].password);
    expect(final[bob.uid].password).toBe(afterFailure[bob.uid].password);
    for (const user of plan.users) expect((await signIn(user.email, final[user.uid].password)).ok).toBe(true);
  });

  it("resumes after a failure while creating documents", async () => {
    await expect(applySeed(plan, failingCreate("comments/seed-v1-open-c3"), credentials())).rejects.toThrow("simulated write failure");
    const partial = await verifySeed(plan, handles);
    expect(partial.record).toBe("applying");
    expect(partial.users.seeded).toBe(3);
    expect(partial.documents.missing).toBeGreaterThan(0);
    const passwords = saved();

    const resumed = await applySeed(plan, handles, credentials(true));
    expect(resumed.users).toEqual({ created: 0, existing: 3 });
    expect(resumed.documents.created + resumed.documents.existing).toBe(18);
    expect((await verifySeed(plan, handles)).record).toBe("applied");
    expect(saved()).toEqual(passwords);
  });

  it.each([
    ["the rename fails", () => failingRename(1)],
    ["a write makes no progress", () => noProgressAfter(2)], // write 1 is the lock, write 2 the new file
    ["a short write is followed by an error", () => shortThenErrorAfter(2)],
  ])("creates no account when the credentials file cannot be updated because %s", async (_label, ops) => {
    await expect(applySeed(plan, handles, credentials(false, ops()))).rejects.toThrow(CredentialsFileError);
    for (const user of plan.users) expect(await accountExists(user.uid)).toBe(false);
    expect(await seedDocCount()).toBe(0);
    expect(saved()).toEqual({});
    expect((await ledger())?.accounts).toEqual({});
  });

  it("stops before the next account when the file fails after one, and resume confirms the first", async () => {
    // Update 1 saves alice's password; update 2 (marking her created) fails after Auth and the ledger confirmed her
    await expect(applySeed(plan, handles, credentials(false, failingRename(2)))).rejects.toThrow(CredentialsFileError);
    expect(await accountExists(alice.uid)).toBe(true);
    expect(await accountExists(bob.uid)).toBe(false);
    expect(saved()[alice.uid].status).toBe("pending");
    expect((await verifySeed(plan, handles)).users.seeded).toBe(1);

    await applySeed(plan, handles, credentials(true));
    const final = saved();
    expect(Object.values(final).map((e) => e.status)).toEqual(["created", "created", "created"]);
    for (const user of plan.users) expect((await signIn(user.email, final[user.uid].password)).ok).toBe(true);
  });

  it.each([
    ["the createUser reply is lost", () => createUserFor(bob.uid, "lost-acknowledgement")],
    ["the ledger cannot confirm the new account", () => failingTransaction(4)], // alice pending, alice created, bob pending, bob created
  ])("leaves an account uncertain, never adopted or deleted, when %s", async (_label, faulty) => {
    await expect(applySeed(plan, faulty(), credentials())).rejects.toThrow(/simulated/);
    expect(await accountExists(bob.uid)).toBe(true);
    expect((await ledger())?.accounts[bob.uid]).toMatchObject({ state: "pending" });

    const verify = await verifySeed(plan, handles);
    expect(verify.users).toEqual({ missing: 1, seeded: 1, foreign: 0, uncertain: 1 });
    expect(verify.uncertain).toEqual([`auth/${bob.uid}`]);
    await expect(applySeed(plan, handles, credentials(true))).rejects.toThrow("Recovering an interrupted apply");
    expect(await accountExists(carol.uid)).toBe(false);

    const removed = await cleanupSeed(plan, handles);
    expect(removed.skipped).toEqual([`auth/${bob.uid} (uncertain)`]);
    expect(await accountExists(bob.uid)).toBe(true);
    expect((await db.doc(RECORD).get()).exists).toBe(true);

    // Its password was saved before createUser, so it is recoverable from the credentials file
    const pending = saved()[bob.uid];
    expect(pending.status).toBe("pending");
    expect((await signIn(bob.email, pending.password)).ok).toBe(true);

    // The documented recovery: a person confirms and deletes the account, then apply resumes with the same password
    await auth.deleteUser(bob.uid);
    const resumed = await applySeed(plan, handles, credentials(true));
    expect(resumed.users).toEqual({ created: 3, existing: 0 }); // cleanup above removed alice, the provably seeded one
    expect(saved()[bob.uid]).toMatchObject({ password: pending.password, status: "created" });
    expect((await signIn(bob.email, pending.password)).ok).toBe(true);
  });

  it("recreates its own confirmed account after someone deleted it, with the same password", async () => {
    await applySeed(plan, handles, credentials());
    const passwords = saved();
    await auth.deleteUser(alice.uid);
    const again = await applySeed(plan, handles, credentials(true));
    expect(again.users).toEqual({ created: 1, existing: 2 });
    expect(saved()[alice.uid]).toMatchObject({ password: passwords[alice.uid].password, status: "created" });
  });
});

describe("applies with different credentials files", () => {
  it("refuses to continue another file's interrupted run, before any write", async () => {
    await expect(applySeed(plan, createUserFor(bob.uid, "fails"), credentials())).rejects.toThrow("simulated");
    const before = await ledger();
    const other = credentials(false, undefined, "other.json");
    await expect(applySeed(plan, handles, other)).rejects.toThrow("another credentials file");
    expect(await ledger()).toEqual(before);
    expect(await accountExists(bob.uid)).toBe(false);
    expect(other.summary()).toMatchObject({ pending: 0, created: 0 });
  });

  it("stops, without adopting the account, when another apply claims it mid-creation", async () => {
    // While this run's createUser for bob is in flight, another run (another file) records bob as its own pending account
    const racing = {
      ...handles,
      auth: {
        ...auth,
        getUser: auth.getUser,
        getUserByEmail: auth.getUserByEmail,
        deleteUser: auth.deleteUser,
        createUser: async (props: { uid?: string }) => {
          if (props.uid === bob.uid) {
            const accounts = (await ledger())!.accounts;
            await db.doc(RECORD).update({ accounts: { ...accounts, [bob.uid]: { email: bob.email, credentialsId: "f".repeat(32), state: "pending" } } });
          }
          return auth.createUser(props as never);
        },
      } as unknown as SeedAuth,
    };
    await expect(applySeed(plan, racing, credentials())).rejects.toThrow("changed by another apply");
    expect(await accountExists(bob.uid)).toBe(true);
    expect((await verifySeed(plan, handles)).uncertain).toEqual([`auth/${bob.uid}`]);
    expect(await cleanupSeed(plan, handles)).toMatchObject({ skipped: [`auth/${bob.uid} (uncertain)`] });
    expect(await accountExists(bob.uid)).toBe(true);
  });
});
