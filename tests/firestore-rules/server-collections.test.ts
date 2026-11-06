/**
 * The AI analysis collections and the publish receipts are managed only by
 * the server (Admin SDK, which bypasses rules). Browsers can neither read
 * nor write them.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from "@jest/globals";
import { assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { asDb, startRulesEnv } from "./setup";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await startRulesEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = asDb(ctx.firestore());
    await setDoc(doc(db, "analysisCache", "f1_abc"), { forumId: "f1", summary: "s" });
    await setDoc(doc(db, "analysisState", "f1"), { lock: null });
    await setDoc(doc(db, "analysisRateLimits", "alice"), { requests: { count: 1 } });
    await setDoc(doc(db, "publishRequests", "abc123"), { uid: "alice", kind: "comment", targetId: "c1" });
  });
});

const ids: Record<string, string> = {
  analysisCache: "f1_abc",
  analysisState: "f1",
  analysisRateLimits: "alice",
  publishRequests: "abc123",
};

describe.each(Object.keys(ids))("%s", (name) => {
  const id = ids[name];
  const contexts = () => [
    ["signed out", asDb(env.unauthenticatedContext().firestore())],
    ["signed in", asDb(env.authenticatedContext("alice").firestore())],
    ["admin claim", asDb(env.authenticatedContext("root", { admin: true }).firestore())],
  ] as const;

  it("denies reads, queries, creates, updates and deletes to every browser user", async () => {
    for (const [, db] of contexts()) {
      await assertFails(getDoc(doc(db, name, id)));
      await assertFails(getDocs(collection(db, name)));
      await assertFails(setDoc(doc(db, name, "new"), { x: 1 }));
      await assertFails(updateDoc(doc(db, name, id), { x: 2 }));
      await assertFails(deleteDoc(doc(db, name, id)));
    }
  });
});

describe("unknown collections", () => {
  it("are denied by default", async () => {
    const db = asDb(env.authenticatedContext("alice", { admin: true }).firestore());
    await assertFails(getDoc(doc(db, "users", "alice")));
    await assertFails(setDoc(doc(db, "votes", "v1"), { type: "upvote" }));
  });
});
