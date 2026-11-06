/**
 * @jest-environment node
 */
import { ANALYZE_LIMITS, readAnalysisRequest, validateAnalysisRequest } from "../analyze-request";

// Shape TeaModal sends today (Firestore comment docs, createdAt serialized by JSON.stringify)
const teaModalMessage = {
  id: "Ab3dEf5hIj7lMn9pQr1t",
  content: "Has anyone tried React Router 7 loaders?",
  userName: "Dana",
  createdAt: { seconds: 1730000000, nanoseconds: 0, type: "firestore/timestamp/1.0" },
  forumId: "Zy9xWv7uTs5rQp3oNm1l",
};
const valid = {
  forumId: "Zy9xWv7uTs5rQp3oNm1l",
  forumTitle: "React Learning Forum",
  forumDescription: "Ask anything",
  forumQuestion: "What next?",
  category: "react",
  messages: [teaModalMessage],
};
const withMessage = (overrides: Record<string, unknown>) => ({
  ...valid,
  messages: [{ ...teaModalMessage, ...overrides }],
});
const reasonOf = (body: unknown) => {
  const result = validateAnalysisRequest(body);
  return result.ok ? "ok" : result.reason;
};

describe("validateAnalysisRequest", () => {
  it("accepts the payload TeaModal sends today", () => {
    expect(validateAnalysisRequest(valid)).toEqual({ ok: true, value: valid });
  });

  it("accepts the legacy message shape with numeric ids", () => {
    const body = {
      forumId: "forum1",
      forumTitle: "Test Forum",
      messages: [{ id: 1, author: "A", content: "Hello", timestamp: "2025-01-01T00:00:00Z", threadId: "t1" }],
    };
    expect(validateAnalysisRequest(body)).toEqual({ ok: true, value: body });
  });

  it("accepts a null createdAt from a pending server timestamp, and empty content", () => {
    expect(reasonOf(withMessage({ createdAt: null, content: "" }))).toBe("ok");
  });

  it("strips unknown keys, including client-supplied user IDs", () => {
    const result = validateAnalysisRequest({
      ...withMessage({ isAdmin: true }),
      uid: "attacker",
      userId: "attacker",
      __proto__: { polluted: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty("uid");
    expect(result.value).not.toHaveProperty("userId");
    expect(result.value.messages[0]).not.toHaveProperty("isAdmin");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["an array", [valid]],
    ["a string", "forumId=1"],
    ["a number", 42],
  ])("rejects a body that is %s", (_label, body) => {
    expect(reasonOf(body)).toBe("invalid_body");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a number", 123],
    ["a path", "forums/abc"],
    ["a traversal", "../abc"],
    ["reserved __id__", "__abc__"],
    ["whitespace", "abc def"],
    ["too long", "a".repeat(129)],
    ["an object", { $ne: "" }],
  ])("rejects a forumId that is %s", (_label, forumId) => {
    expect(reasonOf({ ...valid, forumId })).toBe("invalid_forum_id");
  });

  it.each([
    ["a number title", { forumTitle: 7 }],
    ["an object category", { category: { toString: "x" } }],
    ["an oversized description", { forumDescription: "x".repeat(ANALYZE_LIMITS.maxTextChars + 1) }],
  ])("rejects %s", (_label, extra) => {
    expect(reasonOf({ ...valid, ...extra })).toBe("invalid_field");
  });

  it.each([
    ["missing", undefined],
    ["an object", { 0: teaModalMessage }],
    ["a string", "hello"],
    ["empty", []],
  ])("rejects messages that are %s", (_label, messages) => {
    expect(reasonOf({ ...valid, messages })).toBe("invalid_messages");
  });

  it("rejects too many messages", () => {
    const messages = Array.from({ length: ANALYZE_LIMITS.maxMessages + 1 }, (_, i) => ({ id: i, content: "x" }));
    expect(reasonOf({ ...valid, messages })).toBe("too_many_messages");
  });

  it.each([
    ["null", null],
    ["a string", "hello"],
    ["missing id", { content: "x" }],
    ["a negative id", { id: -1, content: "x" }],
    ["a fractional id", { id: 1.5, content: "x" }],
    ["a path id", { id: "a/b", content: "x" }],
    ["missing content", { id: 1 }],
    ["non-string content", { id: 1, content: ["x"] }],
    ["a number author", { id: 1, content: "x", author: 5 }],
    ["an object threadId", { id: 1, content: "x", threadId: {} }],
    ["a bad createdAt", { id: 1, content: "x", createdAt: { seconds: "1", nanoseconds: 0 } }],
    ["createdAt with extra keys", { id: 1, content: "x", createdAt: { seconds: 1, nanoseconds: 0, evil: 1 } }],
  ])("rejects a message that is %s", (_label, message) => {
    expect(reasonOf({ ...valid, messages: [message] })).toBe("invalid_message");
  });

  it("rejects a message over the per-message limit", () => {
    expect(reasonOf(withMessage({ content: "x".repeat(ANALYZE_LIMITS.maxContentChars + 1) }))).toBe(
      "message_too_long"
    );
  });

  it("rejects messages over the total content limit", () => {
    const count = Math.floor(ANALYZE_LIMITS.maxTotalContentChars / ANALYZE_LIMITS.maxContentChars) + 1;
    const messages = Array.from({ length: count }, (_, i) => ({
      id: i,
      content: "x".repeat(ANALYZE_LIMITS.maxContentChars),
    }));
    expect(reasonOf({ ...valid, messages })).toBe("content_too_long");
  });
});

describe("readAnalysisRequest", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/analyzeMessages", { method: "POST", body, headers });

  it("parses and validates a JSON body", async () => {
    expect(await readAnalysisRequest(post(JSON.stringify(valid)))).toEqual({ ok: true, value: valid });
  });

  it.each(["", "{", "not json", "{'forumId': 1}"])("rejects invalid JSON %j with 400", async (body) => {
    expect(await readAnalysisRequest(post(body))).toEqual({ ok: false, status: 400, reason: "invalid_json" });
  });

  it("rejects a declared Content-Length over the limit with 413 before reading", async () => {
    const request = post("{}", { "Content-Length": String(ANALYZE_LIMITS.maxBodyBytes + 1) });
    const text = jest.spyOn(request, "text");
    expect(await readAnalysisRequest(request)).toEqual({ ok: false, status: 413, reason: "body_too_large" });
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects an oversized body even without Content-Length", async () => {
    const huge = JSON.stringify({ ...valid, padding: "x".repeat(ANALYZE_LIMITS.maxBodyBytes) });
    expect(await readAnalysisRequest(post(huge))).toEqual({ ok: false, status: 413, reason: "body_too_large" });
  });

  it("counts bytes, not characters, for multi-byte text", async () => {
    const emoji = "🍵".repeat(Math.ceil(ANALYZE_LIMITS.maxBodyBytes / 4) + 1);
    expect((await readAnalysisRequest(post(JSON.stringify({ e: emoji })))).ok).toBe(false);
  });
});
