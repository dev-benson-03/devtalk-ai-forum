/**
 * Publishing admission (app/api/publish-limits.server.ts) against the
 * Firestore emulator with the real Admin SDK: real transactions under
 * contention. Moderation is stubbed (no OpenAI calls).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore as AdminFirestore } from "firebase-admin/firestore";
import type { AuthenticatedUser } from "../../app/auth/authenticate.server";
import type { Moderator } from "../../app/moderation/moderation.server";
import { MODERATION_POLICY_VERSION } from "../../app/moderation/policy.server";
import { admitPublish, PUBLISH_LIMITS, PUBLISH_LIMIT_COLLECTION, PublishLimitStoreError } from "../../app/api/publish-limits.server";
import { publishComment } from "../../app/api/publish.server";
import { seedForums } from "./fixtures";
import { startRulesEnv } from "./setup";

let env: RulesTestEnvironment;
let adminApp: App;
let admin: AdminFirestore;

beforeAll(async () => {
  env = await startRulesEnv();
  adminApp = initializeApp({ projectId: "demo-devtalk" }, "publish-limits-tests");
  admin = getFirestore(adminApp);
});
afterAll(async () => {
  await admin.terminate();
  await deleteApp(adminApp);
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedForums(env);
});

const userFor = (uid: string) => ({ uid, token: { uid, name: uid } }) as unknown as AuthenticatedUser;
let moderated = 0;
const approve: Moderator = {
  moderate: async () => {
    moderated++;
    return { allowed: true, policyVersion: MODERATION_POLICY_VERSION, support: false };
  },
};
const deps = () => ({ db: admin as never, moderator: approve });
let n = 0;
const requestId = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const comment = (id = requestId()) => ({ forumId: "open", content: "Nice thread", anonymous: false, requestId: id });
const commentsOn = async (forumId: string) =>
  (await admin.collection("comments").where("forumId", "==", forumId).get()).size;

/**
 * Under heavy contention a Firestore transaction may give up. Only these
 * codes are expected here: ABORTED (contention) and DEADLINE_EXCEEDED (the
 * emulator's lock timeout). Any other error still fails the test.
 */
const TRANSIENT_CODES = new Set([4, 10]);
const codeOf = (error: unknown) => (error as { code?: unknown } | null)?.code as number | undefined;

/**
 * Where an expected failure happened: the admission transaction (reported as
 * PublishLimitStoreError: 503, nothing moderated or written) or the final
 * publishing transaction (propagated as is, after moderation). Unexpected
 * errors are rethrown so the test fails.
 */
function classify(error: unknown): "quota_failed" | "write_failed" {
  if (error instanceof PublishLimitStoreError && TRANSIENT_CODES.has(codeOf(error.cause) as number)) return "quota_failed";
  if (!(error instanceof PublishLimitStoreError) && TRANSIENT_CODES.has(codeOf(error) as number)) return "write_failed";
  throw error;
}

const settle = async <T,>(calls: Array<Promise<T>>) =>
  (await Promise.allSettled(calls)).map((r) =>
    r.status === "fulfilled" ? { ok: true as const, value: r.value } : { ok: false as const, failure: classify(r.reason) }
  );
const valuesOf = <T,>(results: Awaited<ReturnType<typeof settle<T>>>) => results.flatMap((r) => (r.ok ? [r.value] : []));
const failuresOf = (results: Array<{ ok: boolean; failure?: string }>, kind: string) =>
  results.filter((r) => !r.ok && r.failure === kind).length;
const stored = async (uid: string) => (await admin.collection(PUBLISH_LIMIT_COLLECTION).doc(uid).get()).data();

describe("publishing admission on real transactions", () => {
  it("never admits more than the allowance under concurrent requests", async () => {
    const { max } = PUBLISH_LIMITS.forums;
    const results = await settle(Array.from({ length: max + 5 }, () => admitPublish(admin as never, "bob", "forum")));
    expect(failuresOf(results, "write_failed")).toBe(0); // admission writes nothing else
    const admitted = valuesOf(results).filter((r) => r.ok).length;
    expect(admitted).toBeGreaterThan(0);
    expect(admitted).toBeLessThanOrEqual(max);
    expect((await stored("bob"))?.forums.count).toBe(admitted);
    expect((await stored("bob"))?.daily.count).toBe(admitted);
  });

  it("keeps separate users' allowances apart under concurrency", async () => {
    const { max } = PUBLISH_LIMITS.forums;
    const calls = ["bob", "carol"].flatMap((uid) => Array.from({ length: max + 2 }, () => admitPublish(admin as never, uid, "forum")));
    const results = await settle(calls);
    const bob = valuesOf(results.slice(0, max + 2)).filter((r) => r.ok).length;
    const carol = valuesOf(results.slice(max + 2)).filter((r) => r.ok).length;
    expect(bob).toBeLessThanOrEqual(max);
    expect(carol).toBeLessThanOrEqual(max);
    expect((await stored("bob"))?.forums.count).toBe(bob);
    expect((await stored("carol"))?.forums.count).toBe(carol);
    // One user's allowance doesn't use the other's: each still has its own room after
    expect(await admitPublish(admin as never, "dave", "forum")).toEqual({ ok: true });
  });

  it("refuses at the boundary on real transactions", async () => {
    for (let i = 0; i < PUBLISH_LIMITS.forums.max; i++) expect((await admitPublish(admin as never, "erin", "forum")).ok).toBe(true);
    expect((await admitPublish(admin as never, "erin", "forum")).ok).toBe(false);
    expect((await admitPublish(admin as never, "erin", "comment")).ok).toBe(true);
  });

  it("publishes no more comments than the allowance when many arrive at once", async () => {
    const { max } = PUBLISH_LIMITS.comments;
    moderated = 0;
    const total = max + 5;
    const results = await settle(Array.from({ length: total }, () => publishComment(deps(), userFor("bob"), comment())));
    const outcomes = valuesOf(results);
    const published = outcomes.filter((o) => o.kind === "published").length;
    const limited = outcomes.filter((o) => o.kind === "rate_limited").length;
    const quotaFailed = failuresOf(results, "quota_failed");
    const writeFailed = failuresOf(results, "write_failed");
    const admitted = (await stored("bob"))?.comments.count;
    expect(published + limited + quotaFailed + writeFailed).toBe(total); // nothing else happened

    // Admission and moderation never exceed the allowance
    expect(admitted).toBeLessThanOrEqual(max);
    expect(moderated).toBeLessThanOrEqual(admitted);
    expect(published).toBeGreaterThan(0);
    // Every moderated attempt either published or failed in the final write,
    // and stays counted either way
    expect(published + writeFailed).toBe(moderated);
    expect(admitted).toBeGreaterThanOrEqual(published + writeFailed);
    // Firestore holds exactly the confirmed publications
    expect(await commentsOn("open")).toBe(published);
    expect((await admin.collection("forums").doc("open").get()).data()?.commentCount).toBe(published);
  });

  it("keeps an admitted attempt counted when the final publishing write fails", async () => {
    // The admission transaction runs for real; the publishing transaction after it fails
    let transactions = 0;
    const failingWrite = new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop !== "runTransaction") return Reflect.get(target, prop, receiver);
        return (fn: never) =>
          ++transactions === 1
            ? target.runTransaction(fn)
            : Promise.reject(Object.assign(new Error("ABORTED: simulated"), { code: 10 }));
      },
    });
    moderated = 0;
    const error = await publishComment({ db: failingWrite as never, moderator: approve }, userFor("bob"), comment()).catch((e) => e);
    expect(classify(error)).toBe("write_failed");
    expect(moderated).toBe(1);
    expect((await stored("bob"))?.comments.count).toBe(1);
    expect(await commentsOn("open")).toBe(0);
    expect((await admin.collection("forums").doc("open").get()).data()?.commentCount).toBeUndefined();
  });

  it("still publishes one comment and one count for concurrent identical submissions", async () => {
    const same = comment();
    const outcomes = valuesOf(await settle(Array.from({ length: 4 }, () => publishComment(deps(), userFor("bob"), same))));
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every((o) => o.kind === "published")).toBe(true);
    expect(new Set(outcomes.map((o) => (o as { id: string }).id)).size).toBe(1);
    expect(await commentsOn("open")).toBe(1);
    expect((await admin.collection("forums").doc("open").get()).data()?.commentCount).toBe(1);
    // Concurrent requests without a completed receipt may each use allowance (up to 4)
    const used = (await stored("bob"))?.comments.count;
    expect(used).toBeGreaterThanOrEqual(1);
    expect(used).toBeLessThanOrEqual(4);
  });
});
