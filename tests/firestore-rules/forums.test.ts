/**
 * forums: visibility, listing, creation, ownership and admin moderation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { buildForumDocument } from "../../app/forum/forum-document";
import { listedForumsQuery } from "../../app/hooks/forum-data";
import { contexts, forum, seedForums } from "./fixtures";
import { startRulesEnv } from "./setup";

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

const get = (db: Firestore, id: string) => getDoc(doc(db, "forums", id));

describe("reading one forum", () => {
  it("is denied when signed out", async () => {
    await assertFails(get(as.signedOut, "open"));
  });

  it("lets any signed-in user read open, closed and legacy forums", async () => {
    for (const id of ["open", "closed", "legacy"]) await assertSucceeds(get(as.bob, id));
  });

  it("shows inactive forums only to their creator and admins", async () => {
    await assertFails(get(as.bob, "inactive"));
    await assertSucceeds(get(as.alice, "inactive"));
    await assertSucceeds(get(as.admin, "inactive"));
  });

  it("shows admin-deleted forums only to admins, not even their creator", async () => {
    await assertFails(get(as.alice, "deleted"));
    await assertFails(get(as.bob, "deleted"));
    await assertFails(get(as.fakeAdmin, "deleted"));
    await assertSucceeds(get(as.admin, "deleted"));
  });
});

describe("listing forums", () => {
  it("allows the forum page's query and returns only listed forums", async () => {
    const snap = await assertSucceeds(getDocs(listedForumsQuery(as.bob)));
    expect(snap.docs.map((d) => d.id).sort()).toEqual(["closed", "open"]);
  });

  it("denies broader queries that could reveal restricted forums", async () => {
    const forums = collection(as.bob, "forums");
    await assertFails(getDocs(forums));
    await assertFails(getDocs(query(forums, where("isActive", "==", true))));
    await assertFails(getDocs(query(forums, where("isAdminDeleted", "==", false))));
    await assertFails(getDocs(query(forums, where("creatorId", "==", "alice"))));
    // Even the creator can't list their hidden forums with a broad query
    await assertFails(getDocs(query(collection(as.alice, "forums"), where("isActive", "==", false))));
  });

  it("denies listing when signed out", async () => {
    await assertFails(getDocs(listedForumsQuery(as.signedOut)));
  });

  it("lets admins list every forum", async () => {
    const snap = await assertSucceeds(getDocs(collection(as.admin, "forums")));
    expect(snap.size).toBe(5);
  });
});

describe("creating forums", () => {
  const form = { title: "New", description: "Desc", question: "Why?", category: "Technology", timeLimit: 1 };
  const alice = { uid: "alice", displayName: "Alice" };
  const create = (db: Firestore, data: Record<string, unknown>) => addDoc(collection(db, "forums"), data);

  it("accepts the create-forum page's document for the signed-in creator", async () => {
    await assertSucceeds(create(as.alice, buildForumDocument(form, alice, "false")));
    await assertSucceeds(create(as.alice, buildForumDocument({ ...form, category: "", timeLimit: 168 }, alice, "true")));
  });

  it("rejects a forum owned by someone else, by 'anonymous', or created signed out", async () => {
    await assertFails(create(as.bob, buildForumDocument(form, alice, "false")));
    await assertFails(create(as.alice, buildForumDocument(form, null, "false")));
    await assertFails(create(as.signedOut, buildForumDocument(form, alice, "false")));
  });

  it.each([
    ["inactive", { isActive: false }],
    ["admin-deleted", { isAdminDeleted: true }],
    ["server analysis fields", { analysisSummary: "Fake", lastAnalyzedAt: "2026-01-01" }],
    ["a prefilled summary", { summary: "Fake" }],
    ["a prefilled roadmap", { actionRoadmap: ["1", "2", "3"] }],
    ["a comment count", { commentCount: 50 }],
    ["votes", { upvotes: 10 }],
    ["an end time in the past", { endTime: Timestamp.fromMillis(Date.now() - 1000) }],
    ["an end time beyond the form's maximum", { endTime: Timestamp.fromMillis(Date.now() + 30 * 86_400_000) }],
    ["a string end time", { endTime: "2030-01-01" }],
    ["a blank title", { title: "   " }],
    ["a too-long title", { title: "t".repeat(201) }],
    ["two tags", { tags: ["a", "b"] }],
    ["a non-string question", { question: 42 }],
  ])("rejects a new forum with %s", async (_label, patch) => {
    await assertFails(create(as.alice, forum(patch)));
  });

  it("rejects a new forum missing required fields", async () => {
    const { description: _omit, ...rest } = forum();
    await assertFails(create(as.alice, rest));
  });
});

describe("updating forums", () => {
  const update = (db: Firestore, id: string, data: Record<string, unknown>) => updateDoc(doc(db, "forums", id), data);

  it("lets the creator edit text, category and visibility", async () => {
    await assertSucceeds(update(as.alice, "open", { title: "Edited", question: "Still?", tags: ["Other"] }));
    await assertSucceeds(update(as.alice, "open", { isActive: false }));
    await assertSucceeds(update(as.alice, "inactive", { isActive: true }));
  });

  it("rejects edits by other users", async () => {
    await assertFails(update(as.bob, "open", { title: "Hijacked" }));
    await assertFails(update(as.bob, "open", { isActive: false }));
    await assertFails(update(as.signedOut, "open", { title: "x" }));
  });

  it.each([
    ["ownership", { creatorId: "bob" }],
    ["the creator name", { creatorName: "Someone else" }],
    ["admin deletion", { isAdminDeleted: true }],
    ["the AI summary", { analysisSummary: "Fake" }],
    ["the AI roadmap", { actionRoadmap: ["a", "b", "c"] }],
    ["the analysis time", { lastAnalyzedAt: "2026-01-01" }],
    ["the legacy summary", { summary: "Fake" }],
    ["the comment count", { commentCount: 99 }],
    ["the end time", { endTime: Timestamp.fromMillis(Date.now() + 86_400_000 * 7) }],
    ["a blank title", { title: "" }],
  ])("rejects the creator changing %s", async (_label, patch) => {
    await assertFails(update(as.alice, "open", patch));
  });

  it("freezes admin-deleted forums for their creator", async () => {
    await assertFails(update(as.alice, "deleted", { title: "Back" }));
    await assertFails(update(as.alice, "deleted", { isAdminDeleted: false }));
  });

  it("lets admins (verified claim only) hide, restore and soft-delete forums", async () => {
    await assertSucceeds(update(as.admin, "open", { isAdminDeleted: true }));
    await assertSucceeds(update(as.admin, "deleted", { isAdminDeleted: false, isActive: true }));
    await assertFails(update(as.fakeAdmin, "open", { isAdminDeleted: true }));
  });

  it("does not let admins rewrite content, ownership or analysis", async () => {
    await assertFails(update(as.admin, "open", { title: "Admin edit" }));
    await assertFails(update(as.admin, "open", { creatorId: "root" }));
    await assertFails(update(as.admin, "open", { analysisSummary: "Fake" }));
  });

  it("rejects a bare +1 to commentCount without a new comment", async () => {
    await assertFails(update(as.bob, "open", { commentCount: 1 }));
    await assertFails(update(as.alice, "open", { commentCount: 1 }));
  });
});

describe("deleting forums", () => {
  it("is limited to admins", async () => {
    await assertFails(deleteDoc(doc(as.alice, "forums", "open")));
    await assertFails(deleteDoc(doc(as.bob, "forums", "open")));
    await assertFails(deleteDoc(doc(as.fakeAdmin, "forums", "open")));
    await assertSucceeds(deleteDoc(doc(as.admin, "forums", "open")));
  });
});
