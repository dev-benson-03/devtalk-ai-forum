/**
 * comments: reading with the forum page's query, denial of every browser
 * create (comments are published by the server after moderation), and
 * comment edits/deletes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { contexts, seedForums } from "./fixtures";
import { asDb, startRulesEnv } from "./setup";

let env: RulesTestEnvironment;
let as: ReturnType<typeof contexts>;

beforeAll(async () => {
  env = await startRulesEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedForums(env);
  as = contexts(env);
});

async function readAs<T>(read: (db: Firestore) => Promise<T>): Promise<T> {
  let result!: T;
  await env.withSecurityRulesDisabled(async (ctx) => {
    result = await read(asDb(ctx.firestore()));
  });
  return result;
}
const readForum = (id: string) => readAs(async (db) => (await getDoc(doc(db, "forums", id))).data()!);
const readComment = (id: string) =>
  readAs(async (db) => {
    const snap = await getDoc(doc(db, "comments", id));
    return snap.exists() ? snap.data() : null;
  });

/** A comment as the app writes it, with full control over the batch for spoofing tests. */
const rawComment = (forumId: string, fields: Record<string, unknown> = {}) => ({
  forumId,
  userId: "bob",
  userName: "Bob",
  content: "Hello",
  createdAt: serverTimestamp(),
  upvotes: 0,
  downvotes: 0,
  ...fields,
});
function batchWrite(db: Firestore, commentId: string, data: Record<string, unknown>, count?: number) {
  const batch = writeBatch(db);
  batch.set(doc(db, "comments", commentId), data);
  if (count !== undefined) batch.update(doc(db, "forums", String(data.forumId)), { commentCount: count });
  return batch.commit();
}

/**
 * The transaction the forum page ran before Phase 3B: the comment
 * <forumId>_<n+1> plus the forum's commentCount, written by the browser.
 */
function oldBrowserComment(db: Firestore, forumId: string, fields: Record<string, unknown> = {}) {
  return runTransaction(db, async (tx) => {
    const forumRef = doc(db, "forums", forumId);
    const count = Number((await tx.get(forumRef)).data()?.commentCount ?? 0);
    tx.set(doc(db, "comments", `${forumId}_${count + 1}`), rawComment(forumId, fields));
    tx.update(forumRef, { commentCount: count + 1 });
  });
}

describe("creating comments from the browser", () => {
  it("denies the old transaction for every user and forum: only the server publishes", async () => {
    await assertFails(oldBrowserComment(as.bob, "open"));
    await assertFails(oldBrowserComment(as.alice, "open", { userId: "alice", userName: "Anonymous User" }));
    await assertFails(oldBrowserComment(as.admin, "open", { userId: "root" }));
    await assertFails(oldBrowserComment(as.bob, "legacy"));
    expect(await readComment("open_1")).toBeNull();
    expect((await readForum("open")).commentCount).toBeUndefined();
  });

  it("denies single writes, batches and signed-out writes", async () => {
    await assertFails(addDoc(collection(as.bob, "comments"), rawComment("open")));
    await assertFails(setDoc(doc(as.bob, "comments", "open_1"), rawComment("open")));
    await assertFails(batchWrite(as.bob, "open_1", rawComment("open"), 1));
    await assertFails(addDoc(collection(as.signedOut, "comments"), rawComment("open")));
  });

  it("denies spoofed authors and forged fields", async () => {
    await assertFails(addDoc(collection(as.bob, "comments"), rawComment("open", { userId: "alice" })));
    await assertFails(addDoc(collection(as.bob, "comments"), rawComment("open", { upvotes: 50, moderationPolicy: "sfw" })));
  });
});

describe("reading comments", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = asDb(ctx.firestore());
      for (const forumId of ["open", "closed", "inactive", "deleted"]) {
        await setDoc(doc(db, "comments", `${forumId}_1`), rawComment(forumId, { createdAt: new Date() }));
      }
      // Legacy comment with a random ID
      await setDoc(doc(db, "comments", "AbCdEf123"), rawComment("open", { createdAt: new Date() }));
    });
  });
  const byForum = (db: Firestore, forumId: string) =>
    getDocs(query(collection(db, "comments"), where("forumId", "==", forumId)));

  it("allows the forum page's query for a visible forum, including legacy comments", async () => {
    const snap = await assertSucceeds(byForum(as.bob, "open"));
    expect(snap.docs.map((d) => d.id).sort()).toEqual(["AbCdEf123", "open_1"]);
    await assertSucceeds(byForum(as.bob, "closed"));
  });

  it("follows the forum's visibility", async () => {
    await assertFails(byForum(as.bob, "inactive"));
    await assertSucceeds(byForum(as.alice, "inactive"));
    await assertFails(byForum(as.alice, "deleted"));
    await assertSucceeds(byForum(as.admin, "deleted"));
    await assertFails(getDoc(doc(as.bob, "comments", "inactive_1")));
    await assertSucceeds(getDoc(doc(as.bob, "comments", "open_1")));
  });

  it("denies signed-out reads and broad comment queries", async () => {
    await assertFails(byForum(as.signedOut, "open"));
    await assertFails(getDocs(collection(as.bob, "comments")));
    await assertFails(getDocs(query(collection(as.bob, "comments"), where("userId", "==", "bob"))));
  });
});

describe("changing comments", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(asDb(ctx.firestore()), "comments", "open_1"), rawComment("open", { createdAt: new Date() }));
    });
  });

  it("does not allow editing, even by the author", async () => {
    await assertFails(updateDoc(doc(as.bob, "comments", "open_1"), { content: "Edited" }));
    await assertFails(updateDoc(doc(as.bob, "comments", "open_1"), { upvotes: 100 }));
    await assertFails(updateDoc(doc(as.admin, "comments", "open_1"), { content: "Edited" }));
  });

  it("lets only admins delete", async () => {
    await assertFails(deleteDoc(doc(as.bob, "comments", "open_1")));
    await assertFails(deleteDoc(doc(as.alice, "comments", "open_1")));
    await assertFails(deleteDoc(doc(as.fakeAdmin, "comments", "open_1")));
    await assertSucceeds(deleteDoc(doc(as.admin, "comments", "open_1")));
  });
});
