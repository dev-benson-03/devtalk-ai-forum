/**
 * @jest-environment node
 *
 * Route tests with mocked Firebase Admin (Auth + Firestore) and OpenAI.
 * No live Firebase or OpenAI calls.
 */
process.env.OPENAI_API_KEY = "test-key";

const SECRET_TOKEN = "eyJhbGciOiJSUzI1NiJ9.SECRET-PAYLOAD.SECRET-SIGNATURE";
const FORUM_ID = "forum1";
const PRIVATE_TEXT = "my private comment text";
const RAW_MODEL_TEXT = "RAW-MODEL-OUTPUT";

// ---- OpenAI mock -----------------------------------------------------------
const mockCreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

// ---- Firebase Admin mock ---------------------------------------------------
type Doc = Record<string, unknown>;
const mockVerifyIdToken = jest.fn();
const mockUpdate = jest.fn();
let mockForums: Record<string, Doc> = {};
let mockComments: Array<{ id: string; data: Doc }> = [];
let mockCache: Record<string, Doc> = {};
let mockForumGetError: unknown = null;
const mockWhere = jest.fn();

jest.mock("../../firebase/admin.server", () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
  getAdminDb: () => ({
    collection: (name: string) => {
      if (name === "comments") {
        return {
          where: (...args: unknown[]) => {
            mockWhere(...args);
            const forumId = args[2];
            return {
              limit: () => ({
                get: async () => ({
                  docs: mockComments
                    .filter((c) => c.data.forumId === forumId)
                    .map((c) => ({ id: c.id, data: () => c.data })),
                }),
              }),
            };
          },
        };
      }
      const store = name === "forums" ? mockForums : mockCache;
      return {
        doc: (id: string) => ({
          get: async () => {
            if (name === "forums" && mockForumGetError) throw mockForumGetError;
            return { exists: id in store, data: () => store[id] };
          },
          update: (fields: Doc) => mockUpdate(name, id, fields),
        }),
      };
    },
  }),
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
const comment = (id: string, data: Doc) => ({ id, data: { forumId: FORUM_ID, ...data } });

const post = (body: unknown, token: string | null = SECRET_TOKEN) =>
  new Request("http://localhost/api/analyzeMessages", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const signedIn = (uid: string, claims: Doc = {}) =>
  mockVerifyIdToken.mockResolvedValue({ uid, ...claims });

const modelReplies = (content: string) =>
  mockCreate.mockResolvedValue({ choices: [{ message: { content } }] });

describe("analyzeMessages action", () => {
  let logs: jest.SpyInstance[];
  const loggedText = () => JSON.stringify(logs.map((spy) => spy.mock.calls));

  beforeEach(() => {
    jest.clearAllMocks();
    mockForums = { [FORUM_ID]: { ...openForum } };
    mockComments = [
      comment("c1", { userId: "u1", userName: "Dana", content: PRIVATE_TEXT, createdAt: at(1) }),
      comment("c2", { userId: "u2", userName: "Lee", content: "Second", createdAt: at(2) }),
      comment("c3", { userId: "u1", userName: "Dana", content: "Third", createdAt: at(3) }),
      comment("x1", { forumId: "other-forum", userId: "u9", content: "Elsewhere" }),
    ];
    mockCache = {};
    mockForumGetError = null;
    signedIn("viewer-uid");
    modelReplies(`{"summary":"Test summary","actionRoadmap":["Step 1","Step 2","Step 3"]}`);
    logs = (["log", "info", "warn", "error"] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {})
    );
  });
  afterEach(() => {
    expect(loggedText()).not.toContain("SECRET-PAYLOAD");
    jest.restoreAllMocks();
  });

  const call = async (request: Request) => {
    const res: Response = await action({ request });
    return { status: res.status, body: await res.json() };
  };
  const expectNoDataOrOpenAI = () => {
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockWhere).not.toHaveBeenCalled();
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
    mockForums[FORUM_ID].isAdminDeleted = true;
    signedIn("owner-uid");
    const { status } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(403);
    expectNoDataOrOpenAI();
  });

  it("lets an admin (custom claim) analyze an admin-deleted forum", async () => {
    mockForums[FORUM_ID].isAdminDeleted = true;
    signedIn("admin-uid", { admin: true });
    expect((await call(post({ forumId: FORUM_ID }))).status).toBe(200);
  });

  it("returns 403 for another user's inactive forum but allows its creator", async () => {
    mockForums[FORUM_ID].isActive = false;
    expect((await call(post({ forumId: FORUM_ID }))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    signedIn("owner-uid");
    expect((await call(post({ forumId: FORUM_ID }))).status).toBe(200);
  });

  it("only lets the forum creator force regeneration", async () => {
    expect((await call(post({ forumId: FORUM_ID, forceRegenerate: true }))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    signedIn("owner-uid");
    expect((await call(post({ forumId: FORUM_ID, forceRegenerate: true }))).status).toBe(200);
  });

  it("ignores client-side admin flags and spoofed user IDs", async () => {
    const body = { forumId: FORUM_ID, forceRegenerate: true, uid: "owner-uid", isAdmin: true, admin: true };
    expect((await call(post(body))).status).toBe(403);
  });

  it.each([
    ["unavailable", 14, 503],
    ["permission denied", 7, 500],
  ])("maps a Firestore %s error to %i without details", async (_label, code, expected) => {
    mockForumGetError = Object.assign(new Error("internal detail"), { code });
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(expected);
    expect(JSON.stringify(body)).not.toContain("internal detail");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ---- Trusted data and analysis -------------------------------------------
  it("analyzes trusted Firestore comments and returns the existing response shape", async () => {
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(200);
    expect(body).toEqual({
      totalMessages: 3,
      uniqueAuthors: 2,
      summary: "Test summary",
      actionRoadmap: ["Step 1", "Step 2", "Step 3"],
    });
    expect(mockWhere).toHaveBeenCalledWith("forumId", "==", FORUM_ID);
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini", temperature: 0.3 }));
    expect(prompt).toContain('Forum: "React Learning Forum"\nDescription: Ask anything\nQuestion: What next?\nCategory: react');
    expect(prompt).toContain(`Thread "main": ${PRIVATE_TEXT}\nSecond\nThird`);
    expect(prompt).not.toContain("Elsewhere");
  });

  it("ignores client-supplied messages and forum metadata", async () => {
    await call(
      post({
        forumId: FORUM_ID,
        forumTitle: "Spoofed title",
        messages: [{ id: 1, author: "x", content: "SPOOFED MESSAGE" }],
      })
    );
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain("SPOOFED");
    expect(prompt).not.toContain("Spoofed title");
  });

  it("keeps thread grouping by parentId", async () => {
    mockComments.push(comment("c4", { userId: "u3", content: "Reply", parentId: "c1", createdAt: at(4) }));
    await call(post({ forumId: FORUM_ID }));
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Thread "c1": Reply');
  });

  it("returns 422 without calling OpenAI when the forum has no comments", async () => {
    mockComments = [];
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(422);
    expect(body.reason).toBe("no_comments");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("writes only the approved analysis fields to the forum", async () => {
    await call(post({ forumId: FORUM_ID }));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [collection, id, fields] = mockUpdate.mock.calls[0];
    expect(collection).toBe("forums");
    expect(id).toBe(FORUM_ID);
    expect(Object.keys(fields).sort()).toEqual(["actionRoadmap", "analysisSummary", "lastAnalyzedAt"]);
    expect(fields.analysisSummary).toBe("Test summary");
  });

  it("drops extra keys and non-string steps from the model output before saving", async () => {
    modelReplies(`{"summary":"S","actionRoadmap":["A",{"x":1},"B"],"isAdminDeleted":true}`);
    const { body } = await call(post({ forumId: FORUM_ID }));
    expect(body.actionRoadmap).toEqual(["A", "B"]);
    expect(mockUpdate.mock.calls[0][2]).not.toHaveProperty("isAdminDeleted");
  });

  it("returns the fallback analysis but does not save it when the model output is unusable", async () => {
    modelReplies(`not json ${RAW_MODEL_TEXT}`);
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(200);
    expect(body.actionRoadmap).toHaveLength(3);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain(RAW_MODEL_TEXT);
  });

  it("serves an existing cache entry without calling OpenAI", async () => {
    const cached = { totalMessages: 3, uniqueAuthors: 2, summary: "Cached", actionRoadmap: ["C"] };
    const { createHash } = require("crypto");
    const hash = createHash("md5")
      .update(JSON.stringify([
        { id: "c1", content: PRIVATE_TEXT },
        { id: "c2", content: "Second" },
        { id: "c3", content: "Third" },
      ]))
      .digest("hex");
    mockCache[`analysis_${FORUM_ID}_${hash}`] = cached;
    const { body } = await call(post({ forumId: FORUM_ID }));
    expect(body).toEqual(cached);
    expect(mockCreate).not.toHaveBeenCalled();
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

  it("returns a generic 500 when OpenAI fails", async () => {
    mockCreate.mockRejectedValue(new Error(`upstream failure ${PRIVATE_TEXT}`));
    const { status, body } = await call(post({ forumId: FORUM_ID }));
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
  });

  // ---- Logging -------------------------------------------------------------
  it("logs structured diagnostics without tokens, comment text or model output", async () => {
    modelReplies(`{"summary":"${RAW_MODEL_TEXT}","actionRoadmap":["1"]}`);
    await call(post({ forumId: FORUM_ID }));
    const text = loggedText();
    expect(text).toContain('"event":"analysis_complete"');
    expect(text).toContain('"forumId":"forum1"');
    expect(text).toContain("elapsedMs");
    expect(text).not.toContain(PRIVATE_TEXT);
    expect(text).not.toContain(RAW_MODEL_TEXT);
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("test-key");
  });
});
