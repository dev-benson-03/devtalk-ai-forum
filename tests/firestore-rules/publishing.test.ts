/**
 * Server-side publishing (app/api/publish.server.ts) against the Firestore
 * emulator with the real Admin SDK: real transactions, contention and
 * create-if-absent semantics. Moderation is stubbed (no OpenAI calls).
 * Browser reads of the published documents still go through the rules.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore as AdminFirestore } from "firebase-admin/firestore";
import { collection, doc, getDoc, getDocs, query, where, type Firestore } from "firebase/firestore";
import type { AuthenticatedUser } from "../../app/auth/authenticate.server";
import { listedForumsQuery } from "../../app/hooks/forum-data";
import type { Moderator } from "../../app/moderation/moderation.server";
import { MODERATION_POLICY_VERSION } from "../../app/moderation/policy.server";
import { publishComment, publishForum, RECEIPT_COLLECTION } from "../../app/api/publish.server";
import { contexts, seedForums } from "./fixtures";
import { startRulesEnv } from "./setup";

let env: RulesTestEnvironment;
let as: ReturnType<typeof contexts>;
let adminApp: App;
let admin: AdminFirestore;

beforeAll(async () => {
  env = await startRulesEnv();
  adminApp = initializeApp({ projectId: "demo-devtalk" }, "publishing-tests");
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
  as = contexts(env);
});

const userFor = (uid: string, claims: Record<string, unknown> = {}) =>
  ({ uid, token: { uid, name: uid[0].toUpperCase() + uid.slice(1), ...claims } }) as unknown as AuthenticatedUser;
const bob = userFor("bob");
const approve: Moderator = { moderate: async () => ({ allowed: true, policyVersion: MODERATION_POLICY_VERSION }) };
const reject: Moderator = {
  moderate: async () => ({ allowed: false, policyVersion: MODERATION_POLICY_VERSION, reason: "sexual", field: "content" }),
};
const deps = (moderator: Moderator = approve) => ({ db: admin as never, moderator });

let n = 0;
const requestId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const comment = (forumId = "open", id = requestId()) => ({ forumId, content: "Nice thread", anonymous: false, requestId: id });

const forumCount = async (id: string) => (await admin.collection("forums").doc(id).get()).data()?.commentCount;
const commentsOf = async (forumId: string) =>
  (await admin.collection("comments").where("forumId", "==", forumId).get()).docs;
const byForum = (db: Firestore, forumId: string) =>
  getDocs(query(collection(db, "comments"), where("forumId", "==", forumId)));

describe("publishing forums", () => {
  it("creates a forum the rules let other users read and list", async () => {
    const outcome = await publishForum(deps(), bob, {
      title: "Typed routes?",
      description: "React Router 7 typegen",
      question: "Worth it?",
      category: "Web Development",
      timeLimitHours: 24,
      anonymous: true,
      requestId: requestId(),
    });
    expect(outcome).toMatchObject({ kind: "published", duplicate: false });
    const id = (outcome as { id: string }).id;
    const snap = await assertSucceeds(getDoc(doc(as.alice, "forums", id)));
    expect(snap.data()).toMatchObject({ creatorId: "bob", creatorName: "Anonymous User", commentCount: 0, isActive: true });
    const listed = await assertSucceeds(getDocs(listedForumsQuery(as.alice)));
    expect(listed.docs.map((d) => d.id)).toContain(id);
    await assertFails(getDoc(doc(as.alice, RECEIPT_COLLECTION, "x")));
  });

  it("writes nothing when moderation rejects", async () => {
    const before = (await admin.collection("forums").get()).size;
    const outcome = await publishForum(deps(reject), bob, {
      title: "t", description: "d", question: "q", category: "Other", timeLimitHours: 1, anonymous: false, requestId: requestId(),
    });
    expect(outcome.kind).toBe("rejected");
    expect((await admin.collection("forums").get()).size).toBe(before);
    expect((await admin.collection(RECEIPT_COLLECTION).get()).size).toBe(0);
  });
});

describe("publishing comments", () => {
  it("creates the comment and increments commentCount atomically", async () => {
    const outcome = await publishComment(deps(), bob, comment());
    expect(outcome).toMatchObject({ kind: "published", duplicate: false });
    expect(await forumCount("open")).toBe(1);
    const [only] = await commentsOf("open");
    expect(only.data()).toMatchObject({ userId: "bob", userName: "Bob", upvotes: 0, moderationPolicy: MODERATION_POLICY_VERSION });
    // Browsers read it through the forum page's query, under the rules
    const snap = await assertSucceeds(byForum(as.alice, "open"));
    expect(snap.size).toBe(1);
  });

  it("counts concurrent comments exactly", async () => {
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => publishComment(deps(), bob, comment())));
    expect(outcomes.every((o) => o.kind === "published" && !o.duplicate)).toBe(true);
    expect(await commentsOf("open")).toHaveLength(5);
    expect(await forumCount("open")).toBe(5);
  });

  it("publishes one comment for concurrent requests with the same requestId", async () => {
    const same = comment();
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => publishComment(deps(), bob, same)));
    const ids = new Set(outcomes.map((o) => (o as { id: string }).id));
    expect(ids.size).toBe(1);
    expect(outcomes.filter((o) => o.kind === "published" && !o.duplicate)).toHaveLength(1);
    expect(await commentsOf("open")).toHaveLength(1);
    expect(await forumCount("open")).toBe(1);
  });

  it("rejects a changed submission under the same requestId, also when sent concurrently", async () => {
    const id = requestId();
    const outcomes = await Promise.all([
      publishComment(deps(), bob, { ...comment("open", id), content: "First version" }),
      publishComment(deps(), bob, { ...comment("open", id), content: "Second version" }),
    ]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["published", "request_reused"]);
    expect(await commentsOf("open")).toHaveLength(1);
    expect(await forumCount("open")).toBe(1);
    // The identical submission still gets the original ID
    const winner = outcomes.find((o) => o.kind === "published") as { id: string };
    const content = (await commentsOf("open"))[0].data().content;
    expect(await publishComment(deps(), bob, { ...comment("open", id), content })).toEqual({
      kind: "published",
      id: winner.id,
      duplicate: true,
    });
  });

  it("re-checks the receipt digest inside the transaction", async () => {
    const id = requestId();
    // Another request with the same ID but different content lands while moderation runs
    const racing: Moderator = {
      moderate: async () => {
        await publishComment(deps(), bob, { ...comment("open", id), content: "The other version" });
        return { allowed: true, policyVersion: MODERATION_POLICY_VERSION };
      },
    };
    expect((await publishComment(deps(racing), bob, comment("open", id))).kind).toBe("request_reused");
    expect(await commentsOf("open")).toHaveLength(1);
    expect(await forumCount("open")).toBe(1);
  });

  it("starts legacy forums without commentCount at 1", async () => {
    await publishComment(deps(), bob, comment("legacy"));
    expect(await forumCount("legacy")).toBe(1);
  });

  it.each([
    ["closed", "closed"],
    ["inactive", "forbidden"],
    ["deleted", "forbidden"],
    ["missing", "not_found"],
  ])("rejects comments on a %s forum", async (forumId, kind) => {
    expect((await publishComment(deps(), bob, comment(forumId))).kind).toBe(kind);
    expect(await commentsOf(forumId)).toHaveLength(0);
  });

  it.each([
    ["deactivated", { isActive: false }],
    ["admin-deleted", { isAdminDeleted: true }],
  ])("writes nothing when the forum is %s while moderation runs", async (_label, change) => {
    const slow: Moderator = {
      moderate: async () => {
        await admin.collection("forums").doc("open").update(change);
        return { allowed: true, policyVersion: MODERATION_POLICY_VERSION };
      },
    };
    const outcome = await publishComment(deps(slow), bob, comment());
    expect(["closed", "forbidden"]).toContain(outcome.kind);
    expect(await commentsOf("open")).toHaveLength(0);
    expect(await forumCount("open")).toBeUndefined();
  });

  it("keeps hidden forums' comments hidden from other browsers", async () => {
    const owner = userFor("alice");
    await publishComment(deps(), owner, comment());
    await admin.collection("forums").doc("open").update({ isActive: false });
    await assertFails(byForum(as.bob, "open"));
    await assertSucceeds(byForum(as.alice, "open"));
    await assertSucceeds(byForum(as.admin, "open"));
  });
});
