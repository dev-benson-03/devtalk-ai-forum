/**
 * comments: reading with the forum page's query, creating through the app's
 * transaction (comment + commentCount), author spoofing, closed and hidden
 * forums, and comment edits/deletes.
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
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { ANONYMOUS_NAME, authorIdentity } from "../../app/forum/author-identity";
import { createCommentRecord, type NewComment } from "../../app/hooks/forum-data";
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

const bobVisible = authorIdentity({ uid: "bob", displayName: "Bob" }, "false");
const bobAnonymous = authorIdentity({ uid: "bob", displayName: "Bob" }, "true");
const comment = (forumId: string, author = bobVisible, content = "Nice thread"): NewComment => ({
  forumId,
  userId: author.id,
  userName: author.name,
  content,
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

describe("creating comments", () => {
  it("accepts the app's transaction and keeps commentCount in step", async () => {
    expect(await assertSucceeds(createCommentRecord(as.bob, comment("open")))).toBe("open_1");
    expect(await assertSucceeds(createCommentRecord(as.alice, comment("open", authorIdentity({ uid: "alice" }, "true"))))).toBe("open_2");
    expect((await readForum("open")).commentCount).toBe(2);
    expect(await readComment("open_1")).toMatchObject({ forumId: "open", userId: "bob", userName: "Bob", upvotes: 0 });
  });

  it("lets a user post with the anonymous display name, stored under their own UID", async () => {
    await assertSucceeds(createCommentRecord(as.bob, comment("open", bobAnonymous)));
    expect(await readComment("open_1")).toMatchObject({ userId: "bob", userName: ANONYMOUS_NAME });
  });

  it("keeps two simultaneous comments distinct (the transaction retries)", async () => {
    const ids = await Promise.all([
      createCommentRecord(as.bob, comment("open")),
      createCommentRecord(as.alice, comment("open", authorIdentity({ uid: "alice" }, "false"))),
    ]);
    expect(ids.sort()).toEqual(["open_1", "open_2"]);
    expect((await readForum("open")).commentCount).toBe(2);
  });

  it("accepts comments on a legacy forum without endTime or commentCount", async () => {
    expect(await assertSucceeds(createCommentRecord(as.bob, comment("legacy")))).toBe("legacy_1");
  });

  it("rejects comments impersonating another UID or the 'anonymous' ID", async () => {
    await assertFails(createCommentRecord(as.bob, { ...comment("open"), userId: "alice" }));
    await assertFails(createCommentRecord(as.bob, comment("open", authorIdentity(null, "true"))));
    expect(await readComment("open_1")).toBeNull();
  });

  it("rejects comments when signed out", async () => {
    await assertFails(createCommentRecord(as.signedOut, comment("open", authorIdentity(null, "true"))));
  });

  it.each(["closed", "inactive", "deleted"])("rejects comments on a %s forum, even by its creator", async (id) => {
    await assertFails(createCommentRecord(as.alice, comment(id, authorIdentity({ uid: "alice" }, "false"))));
    await assertFails(createCommentRecord(as.admin, comment(id, authorIdentity({ uid: "root" }, "false"))));
  });

  it("rejects comments on a forum that doesn't exist", async () => {
    await assertFails(batchWrite(as.bob, "missing_1", rawComment("missing")));
  });

  it("rejects a comment without the matching commentCount increment", async () => {
    await assertFails(addDoc(collection(as.bob, "comments"), rawComment("open")));
    await assertFails(setDoc(doc(as.bob, "comments", "open_1"), rawComment("open")));
    await assertFails(batchWrite(as.bob, "open_7", rawComment("open"), 1)); // ID doesn't match the count
    await assertFails(batchWrite(as.bob, "open_2", rawComment("open"), 2)); // +2
  });

  it("rejects forged fields and bad content", async () => {
    await assertSucceeds(batchWrite(as.bob, "open_1", rawComment("open"), 1));
    const bad: Array<Record<string, unknown>> = [
      { upvotes: 50 },
      { downvotes: 3 },
      { createdAt: new Date("2020-01-01") },
      { parentId: "x" },
      { isAdmin: true },
      { content: "" },
      { content: "   " },
      { content: "x".repeat(5001) },
      { userName: "" },
    ];
    for (const fields of bad) await assertFails(batchWrite(as.bob, "open_2", rawComment("open", fields), 2));
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
    await assertSucceeds(createCommentRecord(as.bob, comment("open")));
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
