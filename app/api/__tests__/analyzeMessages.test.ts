/**
 * @jest-environment node
 *
 * Route tests with mocked Firebase Admin (Auth + an in-memory Firestore) and
 * a mocked OpenAI client. No live Firebase or OpenAI calls.
 */
import { FakeFirestore } from "../__fixtures__/fake-firestore";
import { ANALYSIS_VERSION, CACHE_COLLECTION, analysisCacheKey } from "../analysis-cache.server";
import { selectForAnalysis, toTrustedComment } from "../analysis-comments";
import { ANALYSIS_QUOTAS as Q, RATE_LIMIT_COLLECTION, STATE_COLLECTION } from "../analysis-limits.server";

process.env.OPENAI_API_KEY = "test-key";

const SECRET_TOKEN = "eyJhbGciOiJSUzI1NiJ9.SECRET-PAYLOAD.SECRET-SIGNATURE";
const FORUM_ID = "forum1";
const PRIVATE_TEXT = "my private comment text";
const RAW_MODEL_TEXT = "RAW-MODEL-OUTPUT";
const STEPS = ["Step 1", "Step 2", "Step 3"];
const VALID_REPLY = JSON.stringify({ summary: "Test summary", actionRoadmap: STEPS });
const T0 = 1_700_000_000_000;

// ---- OpenAI mock -----------------------------------------------------------
const mockCreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

// ---- Firebase Admin mock (in-memory Firestore) -------------------------------
type Doc = Record<string, unknown>;
const mockVerifyIdToken = jest.fn();
let mockDb: FakeFirestore;

jest.mock("../../firebase/admin.server", () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
  getAdminDb: () => mockDb,
}));

const { action } = require("../analyzeMessages");

// ---- Fixtures --------------------------------------------------------------
const at = (ms: number) => ({ toMillis: () => ms });
const openForum = {
  title: "React Learning Forum",
  description: "Ask anything",
  question: "What next?",
  tags: ["react"],
  creatorId: "owner-uid",
  isActive: true,
  isAdminDeleted: false,
};
const addComment = (id: string, data: Doc) => mockDb.seed("comments", id, { forumId: FORUM_ID, ...data });
const forumDoc = () => mockDb.read("forums", FORUM_ID)!;

/** The cache key the route computes for the forum's current comments. */
function currentKey(): string {
  const comments = [...mockDb.docs.entries()]
    .filter(([path, data]) => path.startsWith("comments/") && data.forumId === FORUM_ID)
    .map(([path, data]) => toTrustedComment(path.slice("comments/".length), data));
  const f = forumDoc();
  const context = { title: f.title, description: f.description, question: f.question, category: (f.tags as string[])[0] };
  return analysisCacheKey(FORUM_ID, context as never, selectForAnalysis(comments));
}

const seedCache = (key: string, fields: Doc = {}) =>
  mockDb.seed(CACHE_COLLECTION, key, {
    forumId: FORUM_ID,
    version: ANALYSIS_VERSION,
    summary: "Cached summary",
    actionRoadmap: ["Cached one", "Cached two", "Cached three"],
    ...fields,
  });

const post = (body: unknown, token: string | null = SECRET_TOKEN) =>
  new Request("http://localhost/api/analyzeMessages", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const signedIn = (uid: string, claims: Doc = {}) => mockVerifyIdToken.mockResolvedValue({ uid, ...claims });
const modelReplies = (content: string) => mockCreate.mockResolvedValue({ choices: [{ message: { content } }] });

describe("analyzeMessages action", () => {
  let logs: jest.SpyInstance[];
  let collections: jest.SpyInstance;
  let now: number;
  const loggedText = () => JSON.stringify(logs.map((spy) => spy.mock.calls));

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = new FakeFirestore();
    mockDb.seed("forums", FORUM_ID, { ...openForum });
    addComment("c1", { userId: "u1", userName: "Dana", content: PRIVATE_TEXT, createdAt: at(1) });
    addComment("c2", { userId: "u2", userName: "Lee", content: "Second", createdAt: at(2) });
    addComment("c3", { userId: "u1", userName: "Dana", content: "Third", createdAt: at(3) });
    mockDb.seed("comments", "x1", { forumId: "other-forum", userId: "u9", content: "Elsewhere" });
    collections = jest.spyOn(mockDb, "collection");
    signedIn("viewer-uid");
    modelReplies(VALID_REPLY);
    now = T0;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    logs = (["log", "info", "warn", "error"] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {})
    );
  });
  afterEach(() => {
    expect(loggedText()).not.toContain("SECRET-PAYLOAD");
    expect(loggedText()).not.toContain(PRIVATE_TEXT);
    jest.restoreAllMocks();
  });

  const call = async (request: Request) => {
    const res: Response = await action({ request });
    return { status: res.status, body: await res.json(), retryAfter: res.headers.get("Retry-After") };
  };
  const analyzeAs = (uid: string, body: Doc = { forumId: FORUM_ID }, claims: Doc = {}) => {
    signedIn(uid, claims);
    return call(post(body));
  };
  const readsOf = (name: string) => collections.mock.calls.filter(([c]) => c === name).length;
  const expectNoDataOrOpenAI = () => {
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDb.writesTo("forums")).toHaveLength(0);
    expect(readsOf("comments")).toBe(0);
  };

  it("returns 405 for non-POST requests", async () => {
    const res: Response = await action({ request: new Request("http://localhost/api/analyzeMessages") });
    expect(res.status).toBe(405);
  });

  // ---- Authentication ------------------------------------------------------
  it("returns 401 without a token, before any data access or OpenAI call", async () => {
    const { status } = await call(post({ forumId: FORUM_ID }, null));
    expect(status).toBe(401);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expectNoDataOrOpenAI();
  });

  it.each([
    ["invalid", "auth/argument-error", 401],
    ["expired", "auth/id-token-expired", 401],
    ["revoked", "auth/id-token-revoked", 401],
    ["Firebase outage", "auth/internal-error", 503],
    ["server credential failure", "auth/invalid-credential", 500],
  ])("maps a %s token check to %s → %i", async (_label, code, expected) => {
    mockVerifyIdToken.mockRejectedValue(Object.assign(new Error(SECRET_TOKEN), { code }));
    const { status } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(expected);
    expectNoDataOrOpenAI();
  });

  // ---- Validation ----------------------------------------------------------
  it.each([
    ["invalid JSON", "{oops", "invalid_json"],
    ["a bad forum ID", { forumId: "forums/../x" }, "invalid_forum_id"],
    ["a non-boolean forceRegenerate", { forumId: FORUM_ID, forceRegenerate: "yes" }, "invalid_field"],
  ])("returns 400 for %s", async (_label, body, reason) => {
    const { status, body: res } = await call(post(body));
    expect(status).toBe(400);
    expect(res).toEqual({ error: "Invalid request", reason });
    expectNoDataOrOpenAI();
  });

  // ---- Forum lookup and authorization ----------------------------------------
  it("returns 404 for a missing forum", async () => {
    const { status } = await call(post({ forumId: "missing" }));
    expect(status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 403 for an admin-deleted forum, even for its creator", async () => {
    forumDoc().isAdminDeleted = true;
    expect((await analyzeAs("owner-uid")).status).toBe(403);
    expectNoDataOrOpenAI();
  });

  it("lets an admin (custom claim) analyze an admin-deleted forum", async () => {
    forumDoc().isAdminDeleted = true;
    expect((await analyzeAs("admin-uid", { forumId: FORUM_ID }, { admin: true })).status).toBe(200);
  });

  it("returns 403 for another user's inactive forum but allows its creator", async () => {
    forumDoc().isActive = false;
    expect((await analyzeAs("viewer-uid")).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    expect((await analyzeAs("owner-uid")).status).toBe(200);
  });

  it("ignores client-side admin flags and spoofed user IDs", async () => {
    const body = { forumId: FORUM_ID, forceRegenerate: true, uid: "owner-uid", isAdmin: true, admin: true };
    expect((await call(post(body))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", 14, 503],
    ["permission denied", 7, 500],
  ])("maps a Firestore %s error to %i without details", async (_label, code, expected) => {
    mockDb.failures.set("forums", Object.assign(new Error("internal detail"), { code }));
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(expected);
    expect(JSON.stringify(body)).not.toContain("internal detail");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ---- Trusted data and analysis -------------------------------------------
  it("analyzes trusted Firestore comments and returns the existing response shape", async () => {
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(200);
    expect(body).toEqual({ totalMessages: 3, uniqueAuthors: 2, summary: "Test summary", actionRoadmap: STEPS });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini", temperature: 0.3 }));
    expect(prompt).toContain('Forum: "React Learning Forum"\nDescription: Ask anything\nQuestion: What next?\nCategory: react');
    expect(prompt).toContain(`Thread "main": ${PRIVATE_TEXT}\nSecond\nThird`);
    expect(prompt).not.toContain("Elsewhere");
  });

  it("ignores client-supplied messages and forum metadata", async () => {
    await call(post({ forumId: FORUM_ID, forumTitle: "Spoofed title", messages: [{ content: "SPOOFED MESSAGE" }] }));
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain("SPOOFED");
    expect(prompt).not.toContain("Spoofed title");
  });

  it("keeps thread grouping by parentId", async () => {
    addComment("c4", { userId: "u3", content: "Reply", parentId: "c1", createdAt: at(4) });
    await call(post({ forumId: FORUM_ID }));
    expect(mockCreate.mock.calls[0][0].messages[0].content).toContain('Thread "c1": Reply');
  });

  it("counts unique authors by UID, legacy names, and never anonymous ones", async () => {
    addComment("c4", { userId: "u3", userName: "Dana", content: "Same name, other user", createdAt: at(4) });
    addComment("c5", { userName: "Legacy Pat", content: "Old comment", createdAt: at(5) });
    addComment("c6", { userId: "anonymous", userName: "Anonymous User", content: "Anon", createdAt: at(6) });
    const { body } = await call(post({ forumId: FORUM_ID }));
    expect(body).toMatchObject({ totalMessages: 6, uniqueAuthors: 4 });
  });

  it("returns 422 without calling OpenAI when the forum has no comments", async () => {
    for (const id of ["c1", "c2", "c3"]) mockDb.docs.delete(`comments/${id}`);
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(422);
    expect(body.reason).toBe("no_comments");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("writes only the approved analysis fields to the forum", async () => {
    modelReplies(JSON.stringify({ summary: "Test summary", actionRoadmap: STEPS, isAdminDeleted: true }));
    await call(post({ forumId: FORUM_ID }));
    const writes = mockDb.writesTo("forums");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ op: "update", id: FORUM_ID });
    expect(Object.keys(writes[0].data).sort()).toEqual(["actionRoadmap", "analysisSummary", "lastAnalyzedAt"]);
    expect(writes[0].data).toMatchObject({ analysisSummary: "Test summary", actionRoadmap: STEPS });
  });

  // ---- Output validation ---------------------------------------------------
  it.each([
    ["not JSON", `not json ${RAW_MODEL_TEXT}`],
    ["a partial roadmap", JSON.stringify({ summary: `${RAW_MODEL_TEXT} summary`, actionRoadmap: ["Step 1", "Step 2"] })],
    ["a non-string step", JSON.stringify({ summary: `${RAW_MODEL_TEXT} summary`, actionRoadmap: ["Step 1", 2, "Step 3"] })],
    ["an empty summary", JSON.stringify({ summary: "  ", actionRoadmap: STEPS })],
    ["a placeholder summary", JSON.stringify({ summary: "...", actionRoadmap: STEPS })],
  ])("returns a retryable 502 and persists nothing for %s", async (_label, content) => {
    modelReplies(content);
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(502);
    expect(body).toEqual({ error: "Analysis unavailable", reason: "invalid_model_output" });
    expect(mockDb.writesTo("forums")).toHaveLength(0);
    expect(mockDb.writesTo(CACHE_COLLECTION)).toHaveLength(0);
    expect(mockDb.read(STATE_COLLECTION, FORUM_ID)!.lock).toBeNull();
    expect(loggedText()).not.toContain(RAW_MODEL_TEXT);
    // No cooldown after a failure: a retry may generate again
    modelReplies(VALID_REPLY);
    expect((await call(post({ forumId: FORUM_ID }))).status).toBe(200);
  });

  it("returns a retryable 502 when OpenAI fails, and releases the lock", async () => {
    mockCreate.mockRejectedValue(new Error(`upstream failure ${PRIVATE_TEXT}`));
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(502);
    expect(body).toEqual({ error: "Analysis unavailable", reason: "upstream_error" });
    expect(mockDb.read(STATE_COLLECTION, FORUM_ID)!.lock).toBeNull();
  });

  it("returns 500 when OpenAI is not configured, after auth and authorization", async () => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = ""; // read at module load, so load a fresh copy
    let status = 0;
    await jest.isolateModulesAsync(async () => {
      const { action: isolated } = require("../analyzeMessages");
      status = (await isolated({ request: post({ forumId: FORUM_ID }) })).status;
    });
    process.env.OPENAI_API_KEY = saved;
    expect(status).toBe(500);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ---- Caching -------------------------------------------------------------
  it("writes a validated cache entry on a miss, then serves it without OpenAI", async () => {
    await call(post({ forumId: FORUM_ID }));
    const key = currentKey();
    expect(mockDb.writesTo(CACHE_COLLECTION).map((w) => w.id)).toEqual([key]);
    expect(mockDb.read(CACHE_COLLECTION, key)).toMatchObject({
      forumId: FORUM_ID,
      version: ANALYSIS_VERSION,
      summary: "Test summary",
      actionRoadmap: STEPS,
    });
    expect(key).not.toContain(PRIVATE_TEXT);

    const again = await analyzeAs("someone-else");
    expect(again).toMatchObject({ status: 200, body: { summary: "Test summary", totalMessages: 3, uniqueAuthors: 2 } });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("serves an existing analysis to an ordinary viewer without OpenAI", async () => {
    seedCache(currentKey());
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(200);
    expect(body).toEqual({
      totalMessages: 3,
      uniqueAuthors: 2,
      summary: "Cached summary",
      actionRoadmap: ["Cached one", "Cached two", "Cached three"],
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDb.writesTo("forums")).toHaveLength(0);
  });

  it.each([
    ["a two-step roadmap", { actionRoadmap: ["Only one", "Only two"] }],
    ["another forum's entry", { forumId: "other-forum" }],
    ["an older analysis version", { version: "old" }],
  ])("regenerates and overwrites an invalid cache entry (%s)", async (_label, patch) => {
    seedCache(currentKey(), patch);
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(200);
    expect(body.summary).toBe("Test summary");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockDb.read(CACHE_COLLECTION, currentKey())).toMatchObject({ forumId: FORUM_ID, summary: "Test summary" });
  });

  it("invalidates the cache when comments change, within the forum's freshness policy", async () => {
    await call(post({ forumId: FORUM_ID }));
    addComment("c4", { userId: "u3", content: "A new comment", createdAt: at(4) });
    modelReplies(JSON.stringify({ summary: "Fresh summary", actionRoadmap: STEPS }));

    // Inside the cooldown: the previous valid analysis, with current counts, no OpenAI call
    now = T0 + Q.forumCooldownMs - 1_000;
    const during = await call(post({ forumId: FORUM_ID }));
    expect(during).toMatchObject({ status: 200, body: { summary: "Test summary", totalMessages: 4, uniqueAuthors: 3 } });
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // After the cooldown: one refresh for the new content
    now = T0 + Q.forumCooldownMs;
    const after = await call(post({ forumId: FORUM_ID }));
    expect(after.body.summary).toBe("Fresh summary");
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockDb.read(CACHE_COLLECTION, currentKey())).toMatchObject({ summary: "Fresh summary" });
  });

  it("returns 429 during the cooldown when no previous analysis can be served", async () => {
    await call(post({ forumId: FORUM_ID }));
    mockDb.docs.delete(`${CACHE_COLLECTION}/${currentKey()}`);
    now = T0 + 60_000;
    const { status, body, retryAfter } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(429);
    expect(body.reason).toBe("forum_cooldown");
    expect(Number(retryAfter)).toBe((Q.forumCooldownMs - 60_000) / 1000);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // ---- Forced regeneration -------------------------------------------------
  it.each([
    ["the forum creator", "owner-uid", {}],
    ["an admin (custom claim)", "admin-uid", { admin: true }],
  ])("lets %s force a regeneration past a valid cache entry", async (_label, uid, claims) => {
    seedCache(currentKey());
    const { status, body } = await analyzeAs(uid, { forumId: FORUM_ID, forceRegenerate: true }, claims);
    expect(status).toBe(200);
    expect(body.summary).toBe("Test summary");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses forced regeneration by an ordinary viewer before any comment read", async () => {
    seedCache(currentKey());
    const { status } = await analyzeAs("viewer-uid", { forumId: FORUM_ID, forceRegenerate: true });
    expect(status).toBe(403);
    expectNoDataOrOpenAI();
  });

  it("applies the forum cooldown to forced regeneration too", async () => {
    await analyzeAs("owner-uid", { forumId: FORUM_ID, forceRegenerate: true });
    now = T0 + 1_000;
    const again = await analyzeAs("owner-uid", { forumId: FORUM_ID, forceRegenerate: true });
    expect(again).toMatchObject({ status: 429, body: { reason: "forum_cooldown" } });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // ---- Rate limits and concurrency -----------------------------------------
  it("rate-limits each verified user with 429 and Retry-After, without reading the forum", async () => {
    seedCache(currentKey());
    for (let i = 0; i < Q.userRequests.max; i++) expect((await call(post({ forumId: FORUM_ID }))).status).toBe(200);
    const forumReads = readsOf("forums");
    const limited = await call(post({ forumId: FORUM_ID }));
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      error: "Too many requests",
      reason: "user_requests",
      retryAfterSeconds: Q.userRequests.windowMs / 1000,
    });
    expect(limited.retryAfter).toBe(String(Q.userRequests.windowMs / 1000));
    expect(readsOf("forums")).toBe(forumReads);
    expect((await analyzeAs("another-user")).status).toBe(200);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("limits OpenAI generations per user across forums", async () => {
    for (let i = 0; i < Q.userGenerations.max; i++) {
      const id = `forum-${i}`;
      mockDb.seed("forums", id, { ...openForum });
      mockDb.seed("comments", `k${i}`, { forumId: id, userId: "u1", content: "Hi", createdAt: at(1) });
      now = T0 + i * Q.userRequests.windowMs; // stay under the request quota
      expect((await call(post({ forumId: id }))).status).toBe(200);
    }
    now = T0 + Q.userGenerations.max * Q.userRequests.windowMs;
    const limited = await call(post({ forumId: FORUM_ID }));
    expect(limited).toMatchObject({ status: 429, body: { reason: "user_generations" } });
    expect(mockCreate).toHaveBeenCalledTimes(Q.userGenerations.max);
  });

  it("makes simultaneous duplicate requests share one OpenAI call", async () => {
    let finish: (value: unknown) => void = () => {};
    mockCreate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const first = call(post({ forumId: FORUM_ID }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await analyzeAs("second-viewer");
    expect(second).toMatchObject({ status: 409, body: { reason: "in_progress" }, retryAfter: "3" });

    finish({ choices: [{ message: { content: VALID_REPLY } }] });
    expect((await first).status).toBe(200);
    const retried = await analyzeAs("second-viewer");
    expect(retried).toMatchObject({ status: 200, body: { summary: "Test summary" } });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("recovers a stale generation lock left by a crashed request", async () => {
    const { Timestamp } = require("firebase-admin/firestore");
    mockDb.seed(STATE_COLLECTION, FORUM_ID, {
      lock: { holder: "crashed", key: "old", expiresAt: Timestamp.fromMillis(T0 - 1) },
    });
    expect((await call(post({ forumId: FORUM_ID }))).status).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain('"event":"stale_lock_recovered"');
    expect(mockDb.read(STATE_COLLECTION, FORUM_ID)!.lock).toBeNull();
  });

  it("does not take over a lock that has not expired", async () => {
    const { Timestamp } = require("firebase-admin/firestore");
    mockDb.seed(STATE_COLLECTION, FORUM_ID, {
      lock: { holder: "busy", key: "k", expiresAt: Timestamp.fromMillis(T0 + 5_000) },
    });
    expect((await call(post({ forumId: FORUM_ID }))).status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["the user quota", RATE_LIMIT_COLLECTION],
    ["the forum lock", STATE_COLLECTION],
  ])("fails closed with 503 when %s storage is unavailable", async (_label, collection) => {
    mockDb.failures.set(collection, Object.assign(new Error("internal detail"), { code: 14 }));
    const { status, body, retryAfter } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(503);
    expect(body).toEqual({ error: "Service unavailable", reason: "rate_limit_unavailable" });
    expect(retryAfter).toBe("30");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDb.writesTo("forums")).toHaveLength(0);
  });

  // ---- Logging -------------------------------------------------------------
  it("logs structured diagnostics without tokens, comment text or model output", async () => {
    modelReplies(JSON.stringify({ summary: `${RAW_MODEL_TEXT} text`, actionRoadmap: STEPS }));
    await call(post({ forumId: FORUM_ID }));
    await call(post({ forumId: FORUM_ID })); // cache hit
    const text = loggedText();
    expect(text).toContain('"event":"analysis_complete"');
    expect(text).toContain('"source":"generated"');
    expect(text).toContain('"source":"cache"');
    expect(text).toContain('"forumId":"forum1"');
    expect(text).toContain("elapsedMs");
    expect(text).not.toContain(PRIVATE_TEXT);
    expect(text).not.toContain(RAW_MODEL_TEXT);
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("test-key");
    expect(text).not.toContain("viewer-uid");
  });
});
