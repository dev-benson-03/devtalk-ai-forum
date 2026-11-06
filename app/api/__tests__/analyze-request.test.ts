/**
 * @jest-environment node
 */
import { ANALYZE_LIMITS, readAnalysisRequest, validateAnalysisRequest } from "../analyze-request";

const FORUM_ID = "Zy9xWv7uTs5rQp3oNm1l";
const reasonOf = (body: unknown) => {
  const result = validateAnalysisRequest(body);
  return result.ok ? "ok" : result.reason;
};

describe("validateAnalysisRequest", () => {
  it("accepts a forum ID", () => {
    expect(validateAnalysisRequest({ forumId: FORUM_ID })).toEqual({
      ok: true,
      value: { forumId: FORUM_ID, forceRegenerate: false },
    });
  });

  it("accepts an explicit forceRegenerate flag", () => {
    expect(validateAnalysisRequest({ forumId: FORUM_ID, forceRegenerate: true })).toEqual({
      ok: true,
      value: { forumId: FORUM_ID, forceRegenerate: true },
    });
  });

  it("drops client-supplied messages, metadata and user IDs", () => {
    const result = validateAnalysisRequest({
      forumId: FORUM_ID,
      forumTitle: "Spoofed title",
      messages: [{ id: 1, content: "spoofed" }],
      uid: "attacker",
      userId: "attacker",
      isAdmin: true,
    });
    expect(result).toEqual({ ok: true, value: { forumId: FORUM_ID, forceRegenerate: false } });
  });

  it.each([
    ["null", null],
    ["an array", [{ forumId: FORUM_ID }]],
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
    expect(reasonOf({ forumId })).toBe("invalid_forum_id");
  });

  it.each([["a string", "true"], ["a number", 1], ["null", null]])(
    "rejects forceRegenerate that is %s",
    (_label, forceRegenerate) => {
      expect(reasonOf({ forumId: FORUM_ID, forceRegenerate })).toBe("invalid_field");
    }
  );
});

describe("readAnalysisRequest", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/analyzeMessages", { method: "POST", body, headers });

  it("parses and validates a JSON body", async () => {
    expect(await readAnalysisRequest(post(JSON.stringify({ forumId: FORUM_ID })))).toEqual({
      ok: true,
      value: { forumId: FORUM_ID, forceRegenerate: false },
    });
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
    const huge = JSON.stringify({ forumId: FORUM_ID, padding: "x".repeat(ANALYZE_LIMITS.maxBodyBytes) });
    expect(await readAnalysisRequest(post(huge))).toEqual({ ok: false, status: 413, reason: "body_too_large" });
  });

  it("counts bytes, not characters, for multi-byte text", async () => {
    const emoji = "🍵".repeat(Math.ceil(ANALYZE_LIMITS.maxBodyBytes / 4) + 1);
    expect((await readAnalysisRequest(post(JSON.stringify({ forumId: FORUM_ID, e: emoji })))).ok).toBe(false);
  });
});
