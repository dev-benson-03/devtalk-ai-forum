/**
 * @jest-environment node
 *
 * POST /api/forums and POST /api/comments with mocked Firebase Admin (Auth +
 * an in-memory Firestore) and a mocked OpenAI Moderation API. Synthetic
 * content only; no live Firebase or OpenAI calls.
 */
import { Timestamp } from "firebase-admin/firestore";
import { FakeFirestore } from "../__fixtures__/fake-firestore";
import { MODERATION_POLICY_VERSION } from "../../moderation/policy.server";
import { RECEIPT_COLLECTION } from "../publish.server";
import { PUBLISH_LIMITS, PUBLISH_LIMIT_COLLECTION } from "../publish-limits.server";

process.env.OPENAI_API_KEY = "test-key";

const SECRET_TOKEN = "eyJhbGciOiJSUzI1NiJ9.SECRET-PAYLOAD.SECRET-SIGNATURE";
const PRIVATE_TEXT = "Private draft text 7731";
const REQUEST_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
const OTHER_REQUEST_ID = "9f0c2a6e-1d4b-4c1a-9e7d-2b8f3c4d5e6f";

// ---- OpenAI Moderation mock -------------------------------------------------
const mockModerate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: class {
    moderations = { create: mockModerate };
  },
}));

const CATEGORIES = [
  "sexual", "sexual/minors", "hate", "hate/threatening", "harassment", "harassment/threatening",
  "violence", "violence/graphic", "self-harm", "self-harm/intent", "self-harm/instructions", "illicit", "illicit/violent",
];
const result = (flags: Record<string, boolean> = {}) => ({
  flagged: Object.values(flags).some(Boolean),
  categories: Object.fromEntries(CATEGORIES.map((c) => [c, flags[c] ?? false])),
  category_scores: Object.fromEntries(CATEGORIES.map((c) => [c, flags[c] ? 0.95 : 0.001])),
});
/** Every input is safe, except those whose text includes a key of `flagged`. */
function moderationSays(flagged: Record<string, Record<string, boolean>> = {}) {
  mockModerate.mockImplementation(async ({ input }: { input: string[] }) => ({
    results: input.map((text) => {
      const hit = Object.keys(flagged).find((marker) => text.includes(marker));
      return result(hit ? flagged[hit] : {});
    }),
  }));
}

// ---- Firebase Admin mock ---------------------------------------------------
const mockVerifyIdToken = jest.fn();
let mockDb: FakeFirestore;
jest.mock("../../firebase/admin.server", () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
  getAdminDb: () => mockDb,
}));

const forumAction = require("../createForum").action as (a: { request: Request }) => Promise<Response>;
const commentAction = require("../createComment").action as (a: { request: Request }) => Promise<Response>;
const createForum = (request: Request) => forumAction({ request });
const createComment = (request: Request) => commentAction({ request });

const signedIn = (uid: string, claims: Record<string, unknown> = {}) =>
  mockVerifyIdToken.mockResolvedValue({ uid, name: "Dana Dev", email: "dana@example.com", ...claims });

const post = (path: string, body: unknown, token: string | null = SECRET_TOKEN) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const forumBody = (fields: Record<string, unknown> = {}) => ({
  title: "Best React state library?",
  description: "Comparing Redux, Zustand and Jotai.",
  question: "Which would you pick for a mid-size app?",
  category: "Web Development",
  timeLimitHours: 24,
  anonymous: false,
  requestId: REQUEST_ID,
  ...fields,
});
const commentBody = (fields: Record<string, unknown> = {}) => ({
  forumId: "open",
  content: "Zustand, because it is small.",
  anonymous: false,
  requestId: REQUEST_ID,
  ...fields,
});

const hoursFromNow = (h: number) => Timestamp.fromMillis(Date.now() + h * 3_600_000);
const baseForum = { title: "T", creatorId: "owner", isActive: true, isAdminDeleted: false, commentCount: 0 };

/** Writes other than the publishing allowance (which counts every admitted attempt). */
const contentWrites = () => mockDb.writes.filter((w) => w.collection !== PUBLISH_LIMIT_COLLECTION);

const docsIn = (collection: string) =>
  [...mockDb.docs.entries()].filter(([path]) => path.startsWith(`${collection}/`)).map(([, data]) => data);

describe("publishing routes", () => {
  let logs: jest.SpyInstance[];
  const loggedText = () => JSON.stringify(logs.map((spy) => spy.mock.calls));

  beforeEach(() => {
    mockDb = new FakeFirestore();
    mockDb.seed("forums", "open", { ...baseForum, endTime: hoursFromNow(1) });
    mockDb.seed("forums", "closed", { ...baseForum, endTime: hoursFromNow(-1) });
    mockDb.seed("forums", "inactive", { ...baseForum, isActive: false, endTime: hoursFromNow(1) });
    mockDb.seed("forums", "deleted", { ...baseForum, isAdminDeleted: true, endTime: hoursFromNow(1) });
    mockDb.seed("forums", "legacy", { title: "Old", creatorId: "anonymous" });
    mockDb.seed("forums", "stringEnd", { ...baseForum, endTime: "2030-01-01" });
    mockVerifyIdToken.mockReset();
    mockModerate.mockReset();
    moderationSays();
    signedIn("dana");
    logs = (["info", "warn", "error", "log"] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {})
    );
  });
  afterEach(() => {
    expect(loggedText()).not.toContain(PRIVATE_TEXT);
    expect(loggedText()).not.toContain("SECRET");
    expect(loggedText()).not.toContain("Dana Dev");
    logs.forEach((spy) => spy.mockRestore());
  });

  describe("authentication", () => {
    it.each([
      ["forum", () => createForum(post("/api/forums", forumBody(), null))],
      ["comment", () => createComment(post("/api/comments", commentBody(), null))],
    ])("rejects a %s without a token", async (_label, call) => {
      expect((await call()).status).toBe(401);
      expect(mockDb.writes).toHaveLength(0);
      expect(mockModerate).not.toHaveBeenCalled();
    });

    it("rejects an invalid token", async () => {
      mockVerifyIdToken.mockRejectedValue(Object.assign(new Error("bad"), { code: "auth/argument-error" }));
      expect((await createComment(post("/api/comments", commentBody()))).status).toBe(401);
      expect((await createForum(post("/api/forums", forumBody()))).status).toBe(401);
      expect(mockDb.writes).toHaveLength(0);
    });

    it("rejects other methods", async () => {
      const res = await createForum(new Request("http://localhost/api/forums"));
      expect(res.status).toBe(405);
    });
  });

  describe("POST /api/forums", () => {
    it("publishes a safe forum owned by the verified user", async () => {
      const res = await createForum(post("/api/forums", forumBody()));
      expect(res.status).toBe(201);
      const { id } = await res.json();
      expect(mockDb.read("forums", id)).toMatchObject({
        title: "Best React state library?",
        creatorId: "dana",
        creatorName: "Dana Dev",
        isActive: true,
        isAdminDeleted: false,
        tags: ["Web Development"],
        messages: [""],
        summary: "",
        actionRoadmap: [""],
        commentCount: 0,
        moderationPolicy: MODERATION_POLICY_VERSION,
      });
      const endMs = (mockDb.read("forums", id)!.endTime as Timestamp).toMillis();
      expect(Math.abs(endMs - (Date.now() + 24 * 3_600_000))).toBeLessThan(5_000);
      expect(mockModerate).toHaveBeenCalledWith({
        model: "omni-moderation-latest",
        input: [
          "Best React state library?",
          "Comparing Redux, Zustand and Jotai.",
          "Which would you pick for a mid-size app?",
          "Dana Dev",
        ],
      });
    });

    it("shows the anonymous name but stores the verified UID", async () => {
      const { id } = await (await createForum(post("/api/forums", forumBody({ anonymous: true })))).json();
      expect(mockDb.read("forums", id)).toMatchObject({ creatorId: "dana", creatorName: "Anonymous User" });
      expect(mockModerate.mock.calls[0][0].input).not.toContain("Dana Dev");
    });

    it.each([
      ["a spoofed creatorId", { creatorId: "alice" }],
      ["a spoofed creatorName", { creatorName: "Alice" }],
      ["an admin flag", { isAdmin: true }],
      ["isActive", { isActive: false }],
      ["isAdminDeleted", { isAdminDeleted: false }],
      ["a comment count", { commentCount: 50 }],
      ["analysis fields", { analysisSummary: "Fake" }],
      ["an endTime", { endTime: "2099-01-01" }],
    ])("rejects %s in the body before moderation", async (_label, extra) => {
      const res = await createForum(post("/api/forums", forumBody(extra)));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid request", reason: "unexpected_field" });
      expect(mockModerate).not.toHaveBeenCalled();
      expect(mockDb.writes).toHaveLength(0);
    });

    it.each([
      ["a blank title", { title: "   " }, "title"],
      ["a too-long description", { description: "d".repeat(2001) }, "description"],
      ["a non-string question", { question: 42 }, "question"],
      ["an unknown category", { category: "Gossip" }, "category"],
      ["an unoffered time limit", { timeLimitHours: 1000 }, "timeLimitHours"],
      ["a missing anonymous flag", { anonymous: "yes" }, "anonymous"],
      ["a bad requestId", { requestId: "abc" }, "requestId"],
    ])("rejects %s", async (_label, fields, field) => {
      const res = await createForum(post("/api/forums", forumBody(fields)));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ reason: "invalid_field", field });
    });

    it("returns 413 for a streamed oversized body without Content-Length, before moderation or Firestore", async () => {
      const { ReadableStream } = require("node:stream/web");
      const chunk = new TextEncoder().encode("x".repeat(8 * 1024));
      let pulls = 0;
      const body = new ReadableStream({
        pull(controller: { enqueue(c: Uint8Array): void }) {
          pulls++;
          controller.enqueue(chunk); // never ends on its own
        },
      });
      const request = { method: "POST", headers: new Headers({ Authorization: `Bearer ${SECRET_TOKEN}` }), body };
      const res = await createComment(request as unknown as Request);
      expect(res.status).toBe(413);
      expect(pulls).toBeLessThan(10);
      expect(mockModerate).not.toHaveBeenCalled();
      expect(mockDb.writes).toHaveLength(0);
    });

    it("rejects non-JSON and oversized bodies", async () => {
      expect((await createForum(post("/api/forums", "{not json"))).status).toBe(400);
      expect((await createForum(post("/api/forums", forumBody({ description: "x".repeat(40_000) })))).status).toBe(413);
    });

    it("rejects prohibited sexual content, keeps nothing and names the field", async () => {
      moderationSays({ [PRIVATE_TEXT]: { sexual: true } });
      const res = await createForum(post("/api/forums", forumBody({ description: PRIVATE_TEXT })));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "Content not allowed", reason: "sexual", field: "description" });
      expect(contentWrites()).toHaveLength(0); // the admitted attempt is still counted
    });

    it("rejects strong profanity in the title and writes nothing", async () => {
      const res = await createForum(post("/api/forums", forumBody({ title: "Why is this sh1t so slow" })));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "Content not allowed", reason: "profanity", field: "title" });
      expect(docsIn("forums").filter((f) => f.creatorId === "dana")).toHaveLength(0);
    });

    it("rejects a profane display name, unless posting anonymously", async () => {
      signedIn("dana", { name: "FuckBot" });
      expect(await (await createForum(post("/api/forums", forumBody()))).json()).toMatchObject({ field: "displayName" });
      expect((await createForum(post("/api/forums", forumBody({ anonymous: true })))).status).toBe(201);
    });

    it("publishes once for a repeated requestId and moderates once", async () => {
      const first = await (await createForum(post("/api/forums", forumBody()))).json();
      const again = await createForum(post("/api/forums", forumBody()));
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ id: first.id, duplicate: true });
      expect(docsIn("forums").filter((f) => f.creatorId === "dana")).toHaveLength(1);
      expect(mockModerate).toHaveBeenCalledTimes(1);
      expect(docsIn(RECEIPT_COLLECTION)).toEqual([expect.objectContaining({ uid: "dana", kind: "forum", targetId: first.id })]);
    });
  });

  describe("moderation outages fail closed", () => {
    it.each([
      ["the provider errors", () => mockModerate.mockRejectedValue(new Error("upstream 500"))],
      [
        "the provider times out",
        () => mockModerate.mockRejectedValue(Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" })),
      ],
      ["the provider answers without results", () => mockModerate.mockResolvedValue({ id: "x" })],
      ["the provider answers malformed results", () => mockModerate.mockResolvedValue({ results: [{ flagged: "no" }] })],
    ])("when %s", async (_label, arrange) => {
      arrange();
      for (const res of [
        await createForum(post("/api/forums", forumBody())),
        await createComment(post("/api/comments", commentBody({ requestId: OTHER_REQUEST_ID }))),
      ]) {
        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBe("30");
        expect(await res.json()).toEqual({ error: "Publishing unavailable", reason: "moderation_unavailable" });
      }
      expect(contentWrites()).toHaveLength(0); // the admitted attempt is still counted
    });

    it("when no OpenAI key is configured", async () => {
      const key = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        expect((await createComment(post("/api/comments", commentBody()))).status).toBe(503);
      } finally {
        process.env.OPENAI_API_KEY = key;
      }
      expect(contentWrites()).toHaveLength(0); // the admitted attempt is still counted
    });
  });

  describe("POST /api/comments", () => {
    it("publishes a safe comment for the verified user and increments commentCount", async () => {
      const res = await createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT })));
      expect(res.status).toBe(201);
      const { id } = await res.json();
      expect(mockDb.read("comments", id)).toMatchObject({
        forumId: "open",
        userId: "dana",
        userName: "Dana Dev",
        content: PRIVATE_TEXT,
        upvotes: 0,
        downvotes: 0,
        moderationPolicy: MODERATION_POLICY_VERSION,
      });
      expect(mockDb.read("forums", "open")!.commentCount).toBe(1);
    });

    it("publishes a personal disclosure and tells only the author to show the support message", async () => {
      moderationSays({ [PRIVATE_TEXT]: { "self-harm/intent": true } });
      const res = await createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT })));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ id: body.id, duplicate: false, support: true });
      // Never stored, logged or put on the receipt
      const stored = JSON.stringify([...mockDb.docs.values()]);
      expect(stored).not.toContain("support");
      expect(stored).not.toContain("self-harm");
      expect(loggedText()).not.toContain("support");
      // A retry of the same request returns the original ID without the flag
      expect(await (await createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT })))).json()).toEqual({
        id: body.id,
        duplicate: true,
      });
    });

    it("rejects self-harm instructions even with a disclosure, writes nothing and returns the support flag", async () => {
      moderationSays({ [PRIVATE_TEXT]: { "self-harm/intent": true, "self-harm/instructions": true } });
      const res = await createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT })));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "Content not allowed", reason: "self_harm", field: "content", support: true });
      expect(contentWrites()).toHaveLength(0); // the admitted attempt is still counted
      expect(loggedText()).not.toContain("support");
    });

    it("leaves the support flag out of ordinary responses", async () => {
      expect(await (await createComment(post("/api/comments", commentBody()))).json()).not.toHaveProperty("support");
    });

    it("keeps the verified UID behind the anonymous name", async () => {
      const { id } = await (await createComment(post("/api/comments", commentBody({ anonymous: true })))).json();
      expect(mockDb.read("comments", id)).toMatchObject({ userId: "dana", userName: "Anonymous User" });
    });

    it("rejects a spoofed author UID or name", async () => {
      for (const extra of [{ userId: "alice" }, { userName: "Alice" }, { createdAt: "2020-01-01" }, { upvotes: 9 }]) {
        expect((await createComment(post("/api/comments", commentBody(extra)))).status).toBe(400);
      }
      expect(mockDb.writes).toHaveLength(0);
    });

    it("accepts legacy forums without endTime or commentCount", async () => {
      expect((await createComment(post("/api/comments", commentBody({ forumId: "legacy" })))).status).toBe(201);
      expect(mockDb.read("forums", "legacy")!.commentCount).toBe(1);
    });

    it.each([
      ["a closed forum", "dana", {}, "closed", 409],
      ["a forum with a string endTime", "dana", {}, "stringEnd", 409],
      ["an inactive forum (other user)", "dana", {}, "inactive", 403],
      ["an inactive forum (its creator)", "owner", {}, "inactive", 409],
      ["an admin-deleted forum", "dana", {}, "deleted", 403],
      ["an admin-deleted forum (admin)", "root", { admin: true }, "deleted", 409],
      ["a missing forum", "dana", {}, "nope", 404],
    ])("rejects comments on %s before moderation", async (_label, uid, claims, forumId, status) => {
      signedIn(uid, claims);
      const res = await createComment(post("/api/comments", commentBody({ forumId })));
      expect(res.status).toBe(status);
      expect(mockModerate).not.toHaveBeenCalled();
      expect(mockDb.writes).toHaveLength(0);
    });

    it.each([
      ["harassment", { harassment: true }, "hate_harassment"],
      ["hate", { hate: true }, "hate_harassment"],
      ["a threat", { "harassment/threatening": true }, "threat"],
    ])("rejects %s without writing", async (_label, flags, reason) => {
      moderationSays({ [PRIVATE_TEXT]: flags });
      const res = await createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT })));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "Content not allowed", reason, field: "content" });
      expect(contentWrites()).toHaveLength(0); // the admitted attempt is still counted
    });

    it("accepts benign educational terminology", async () => {
      const content = "Our health app stores breast cancer screening results; how should we encrypt them?";
      expect((await createComment(post("/api/comments", commentBody({ content })))).status).toBe(201);
    });

    it.each([
      ["closed", { isActive: false }],
      ["admin-deleted", { isAdminDeleted: true }],
      ["ended", { endTime: hoursFromNow(-1) }],
    ])("does not publish when the forum is %s while moderation runs", async (_label, change) => {
      mockModerate.mockImplementation(async ({ input }: { input: string[] }) => {
        mockDb.seed("forums", "open", { ...mockDb.read("forums", "open"), ...change });
        return { results: input.map(() => result()) };
      });
      const res = await createComment(post("/api/comments", commentBody()));
      expect([403, 409]).toContain(res.status);
      expect(docsIn("comments")).toHaveLength(0);
      expect(mockDb.read("forums", "open")!.commentCount).toBe(0);
    });

    it("publishes once for a repeated requestId", async () => {
      const first = await (await createComment(post("/api/comments", commentBody()))).json();
      const again = await createComment(post("/api/comments", commentBody()));
      expect(await again.json()).toEqual({ id: first.id, duplicate: true });
      expect(docsIn("comments")).toHaveLength(1);
      expect(mockDb.read("forums", "open")!.commentCount).toBe(1);
    });

    it("rejects a changed submission under a used requestId, without moderating or writing", async () => {
      const first = await (await createComment(post("/api/comments", commentBody()))).json();
      mockModerate.mockClear();
      const writes = mockDb.writes.length;
      for (const changed of [{ content: "Edited text" }, { anonymous: true }, { forumId: "legacy" }]) {
        const res = await createComment(post("/api/comments", commentBody(changed)));
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: "Invalid request", reason: "request_reused" });
      }
      expect(mockModerate).not.toHaveBeenCalled();
      expect(mockDb.writes).toHaveLength(writes);
      expect(docsIn("comments")).toEqual([expect.objectContaining({ content: "Zustand, because it is small." })]);
      expect((await (await createComment(post("/api/comments", commentBody()))).json()).id).toBe(first.id);
    });

    it("binds forum receipts to every field that changes the forum", async () => {
      await createForum(post("/api/forums", forumBody()));
      for (const changed of [{ title: "Other" }, { category: "Other" }, { timeLimitHours: 1 }, { anonymous: true }]) {
        expect((await createForum(post("/api/forums", forumBody(changed)))).status).toBe(409);
      }
      expect(docsIn("forums").filter((f) => f.creatorId === "dana")).toHaveLength(1);
    });

    it("stores only a digest in the receipt, never the text", async () => {
      await createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT })));
      const [receipt] = docsIn(RECEIPT_COLLECTION);
      expect(receipt.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(receipt)).not.toContain(PRIVATE_TEXT);
      expect(JSON.stringify(receipt)).not.toContain("Dana Dev");
    });

    it("lets a rejected submission be corrected and resent with the same requestId", async () => {
      moderationSays({ [PRIVATE_TEXT]: { harassment: true } });
      expect((await createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT })))).status).toBe(422);
      expect((await createComment(post("/api/comments", commentBody({ content: "A kinder version" })))).status).toBe(201);
    });

    it("does not let one requestId publish both a forum and a comment", async () => {
      await createForum(post("/api/forums", forumBody()));
      const res = await createComment(post("/api/comments", commentBody()));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ reason: "request_reused" });
    });

    it("counts concurrent comments exactly", async () => {
      const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
      const results = await Promise.all(ids.map((requestId) => createComment(post("/api/comments", commentBody({ requestId })))));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(docsIn("comments")).toHaveLength(3);
      expect(mockDb.read("forums", "open")!.commentCount).toBe(3);
    });

    it("answers 503 for a transient Firestore failure, 500 otherwise", async () => {
      mockDb.writeFailures.set("comments", Object.assign(new Error("unavailable"), { code: 14 }));
      expect((await createComment(post("/api/comments", commentBody()))).status).toBe(503);
      mockDb.writeFailures.set("comments", Object.assign(new Error("boom"), { code: 13 }));
      expect((await createComment(post("/api/comments", commentBody({ requestId: OTHER_REQUEST_ID })))).status).toBe(500);
      expect(docsIn("comments")).toHaveLength(0);
      expect(mockDb.read("forums", "open")!.commentCount).toBe(0);
    });
  });

  describe("publishing rate limits", () => {
    /** Uses up a user's allowance for one window, as if `count` attempts were just admitted. */
    const exhaust = (field: "forums" | "comments" | "daily", uid = "dana", count?: number) => {
      const max = count ?? PUBLISH_LIMITS[field].max;
      mockDb.seed(PUBLISH_LIMIT_COLLECTION, uid, {
        ...mockDb.read(PUBLISH_LIMIT_COLLECTION, uid),
        [field]: { start: Timestamp.fromMillis(Date.now() - 1_000), count: max },
      });
    };
    const used = (field: "forums" | "comments" | "daily", uid = "dana") =>
      (mockDb.read(PUBLISH_LIMIT_COLLECTION, uid)?.[field] as { count?: number } | undefined)?.count ?? 0;

    it("counts each admitted forum and comment against the verified user", async () => {
      expect((await createForum(post("/api/forums", forumBody()))).status).toBe(201);
      expect((await createComment(post("/api/comments", commentBody({ requestId: OTHER_REQUEST_ID })))).status).toBe(201);
      expect([used("forums"), used("comments"), used("daily")]).toEqual([1, 1, 2]);
      expect(mockDb.read(PUBLISH_LIMIT_COLLECTION, "alice")).toBeUndefined();
    });

    it.each([
      ["forum", "forums", () => createForum(post("/api/forums", forumBody({ description: PRIVATE_TEXT })))],
      ["comment", "comments", () => createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT })))],
      ["forum (daily cap)", "daily", () => createForum(post("/api/forums", forumBody({ description: PRIVATE_TEXT })))],
    ] as const)("returns 429 for a %s over the limit, without moderation or writes", async (_label, field, call) => {
      exhaust(field);
      const res = await call();
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body).toEqual({ error: "Too many requests", reason: "rate_limited", retryAfterSeconds: expect.any(Number) });
      expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(body.retryAfterSeconds).toBeLessThanOrEqual(PUBLISH_LIMITS[field].windowMs / 1000);
      expect(res.headers.get("Retry-After")).toBe(String(body.retryAfterSeconds));
      expect(mockModerate).not.toHaveBeenCalled();
      expect(contentWrites()).toHaveLength(0);
      expect(loggedText()).toContain("rate_limited");
    });

    it("lets a user who hit the forum limit still comment, and other users still post", async () => {
      exhaust("forums");
      expect((await createComment(post("/api/comments", commentBody()))).status).toBe(201);
      signedIn("erin");
      expect((await createForum(post("/api/forums", forumBody({ requestId: OTHER_REQUEST_ID })))).status).toBe(201);
    });

    it("fails closed with 503 when quota storage is unavailable, without moderation or writes", async () => {
      mockDb.failures.set(PUBLISH_LIMIT_COLLECTION, Object.assign(new Error("UNAVAILABLE: quota"), { code: 14 }));
      for (const res of [
        await createForum(post("/api/forums", forumBody({ description: PRIVATE_TEXT }))),
        await createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT }))),
      ]) {
        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBe("30");
        expect(await res.json()).toEqual({ error: "Publishing unavailable", reason: "rate_limit_unavailable" });
      }
      expect(mockModerate).not.toHaveBeenCalled();
      expect(mockDb.writes).toHaveLength(0);
      expect(loggedText()).toContain("rate_limit_unavailable");
      expect(loggedText()).not.toContain("UNAVAILABLE: quota");
    });

    it("counts attempts that moderation rejects, so rejected content can't be resent without limit", async () => {
      moderationSays({ [PRIVATE_TEXT]: { harassment: true } });
      exhaust("comments", "dana", PUBLISH_LIMITS.comments.max - 1);
      const send = () => createComment(post("/api/comments", commentBody({ content: PRIVATE_TEXT })));
      expect((await send()).status).toBe(422);
      expect((await send()).status).toBe(429);
      expect(mockModerate).toHaveBeenCalledTimes(1);
    });

    it("counts attempts that fail because moderation is unavailable", async () => {
      mockModerate.mockRejectedValue(new Error("upstream 500"));
      exhaust("forums", "dana", PUBLISH_LIMITS.forums.max - 1);
      expect((await createForum(post("/api/forums", forumBody()))).status).toBe(503);
      expect((await createForum(post("/api/forums", forumBody()))).status).toBe(429);
    });

    it("returns a completed identical retry without moderation or new allowance, even at the limit", async () => {
      const first = await (await createComment(post("/api/comments", commentBody()))).json();
      exhaust("comments");
      exhaust("daily");
      mockModerate.mockClear();
      const again = await createComment(post("/api/comments", commentBody()));
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ id: first.id, duplicate: true });
      expect(mockModerate).not.toHaveBeenCalled();
      expect(used("comments")).toBe(PUBLISH_LIMITS.comments.max);
    });

    it("still returns 409 request_reused for a changed submission at the limit", async () => {
      await createComment(post("/api/comments", commentBody()));
      exhaust("comments");
      const res = await createComment(post("/api/comments", commentBody({ content: "Edited after a lost response" })));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ reason: "request_reused" });
    });

    it("checks the forum before using allowance", async () => {
      for (const forumId of ["closed", "deleted", "missing"]) {
        expect((await createComment(post("/api/comments", commentBody({ forumId })))).status).not.toBe(201);
      }
      expect(mockDb.read(PUBLISH_LIMIT_COLLECTION, "dana")).toBeUndefined();
    });

    it("uses no allowance and no moderation for unauthenticated or malformed requests", async () => {
      await createForum(post("/api/forums", forumBody(), null));
      await createForum(post("/api/forums", "{not json"));
      await createComment(post("/api/comments", commentBody({ userId: "alice" })));
      expect(mockDb.writes).toHaveLength(0);
      expect(mockModerate).not.toHaveBeenCalled();
    });
  });
});
