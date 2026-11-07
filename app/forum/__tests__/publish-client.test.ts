import { PublishError, SUPPORT_MESSAGE, publishComment, publishErrorMessage, publishForum } from "../publish-client";

const TOKEN = "SECRET-ID-TOKEN";
const user = (getIdToken = jest.fn(async () => TOKEN)) => ({ getIdToken }) as never;
const respond = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
const comment = { forumId: "f1", content: "Hi", anonymous: true, requestId: "r1" };

describe("publish client", () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  it("posts the submission with a Bearer token and returns the id", async () => {
    fetchMock.mockResolvedValue(respond(201, { id: "c1" }));
    await expect(publishComment(comment, async () => user())).resolves.toEqual({ id: "c1" });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/comments");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual(comment);
  });

  it("retries once with a refreshed token after a 401", async () => {
    const getIdToken = jest.fn(async () => TOKEN);
    fetchMock.mockResolvedValueOnce(respond(401)).mockResolvedValueOnce(respond(201, { id: "f1" }));
    await publishForum({} as never, async () => user(getIdToken));
    expect(getIdToken.mock.calls).toEqual([[false], [true]]);
  });

  it.each([
    [401, {}, "signed_out"],
    [422, { reason: "sexual", field: "title" }, "rejected"],
    [409, { reason: "forum_closed" }, "closed"],
    [503, { reason: "moderation_unavailable" }, "unavailable"],
    [409, { reason: "request_reused" }, "failed"],
    [500, {}, "failed"],
  ])("maps status %s to %s", async (status, body, kind) => {
    fetchMock.mockResolvedValue(respond(status, body));
    const error = await publishComment(comment, async () => user()).catch((e) => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error.kind).toBe(kind);
    expect(error.message).not.toContain(TOKEN);
  });

  it("treats a network failure as unavailable and a signed-out user as signed_out", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect((await publishComment(comment, async () => user()).catch((e) => e)).kind).toBe("unavailable");
    expect((await publishComment(comment, async () => null).catch((e) => e)).kind).toBe("signed_out");
  });

  it("ignores unexpected reason and field text from the response", async () => {
    fetchMock.mockResolvedValue(respond(422, { reason: "<script>", field: "x".repeat(100) }));
    const error = await publishComment(comment, async () => user()).catch((e) => e);
    expect(error).toMatchObject({ reason: undefined, field: undefined });
    expect(publishErrorMessage(error, "fallback")).toBe(
      "Your post doesn't meet DevTalk's community guidelines. Please revise it and try again."
    );
  });

  it("writes a respectful message for each case", () => {
    expect(publishErrorMessage(new PublishError("rejected", 422, "profanity", "displayName"), "x")).toBe(
      "Your display name doesn't meet DevTalk's community guidelines (strong profanity). Please post anonymously or change your display name."
    );
    expect(publishErrorMessage(new PublishError("signed_out"), "x")).toBe("Please sign in again to post.");
    expect(publishErrorMessage(new Error("internal detail"), "Failed to post message. Please try again.")).toBe(
      "Failed to post message. Please try again."
    );
  });

  it("passes the support flag through only when the server sets it to true", async () => {
    fetchMock.mockResolvedValueOnce(respond(201, { id: "c1", support: true }));
    await expect(publishComment(comment, async () => user())).resolves.toEqual({ id: "c1", support: true });
    fetchMock.mockResolvedValueOnce(respond(201, { id: "c2", support: "yes" }));
    await expect(publishComment(comment, async () => user())).resolves.toEqual({ id: "c2" });
    fetchMock.mockResolvedValueOnce(respond(422, { reason: "self_harm", field: "content", support: true }));
    const error = await publishComment(comment, async () => user()).catch((e) => e);
    expect(error).toMatchObject({ kind: "rejected", reason: "self_harm", support: true });
  });

  it("adds the support message to a rejection only when flagged", () => {
    expect(publishErrorMessage(new PublishError("rejected", 422, "self_harm", "content", true), "x")).toBe(
      "Your message doesn't meet DevTalk's community guidelines (content that could encourage self-harm). Please revise it and try again.\n\n" +
        SUPPORT_MESSAGE
    );
    expect(publishErrorMessage(new PublishError("rejected", 422, "hate_harassment", "content"), "x")).not.toContain("988");
  });

  it("offers resources without promising monitoring, review or intervention", () => {
    expect(SUPPORT_MESSAGE).toContain("988");
    expect(SUPPORT_MESSAGE).toContain("In the U.S.");
    expect(SUPPORT_MESSAGE).toContain("findahelpline.com");
    for (const promise of [/monitor/i, /moderator/i, /we will/i, /we'll/i, /contact you/i, /reach out to you/i, /notif/i, /review/i, /alert/i, /at risk/i]) {
      expect(SUPPORT_MESSAGE).not.toMatch(promise);
    }
  });

  it("maps 429 to rate_limited with a bounded wait from the server", async () => {
    fetchMock.mockResolvedValue(respond(429, { reason: "rate_limited", retryAfterSeconds: 125 }));
    const error = await publishComment(comment, async () => user()).catch((e) => e);
    expect(error).toMatchObject({ kind: "rate_limited", status: 429, reason: "rate_limited", retryAfterSeconds: 125 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // never retried automatically
    for (const bad of [-5, 0, 1.5, "60", 10 ** 9, undefined]) {
      fetchMock.mockResolvedValue(respond(429, { reason: "rate_limited", retryAfterSeconds: bad }));
      expect((await publishComment(comment, async () => user()).catch((e) => e)).retryAfterSeconds).toBeUndefined();
    }
  });

  it.each([
    [undefined, "You're posting faster than DevTalk allows. Your draft is still here, so please try again later."],
    [20, "You're posting faster than DevTalk allows. Your draft is still here, so please try again in about 20 seconds."],
    [61, "You're posting faster than DevTalk allows. Your draft is still here, so please try again in about 2 minutes."],
    [60, "You're posting faster than DevTalk allows. Your draft is still here, so please try again in about 1 minute."],
    [3 * 3600, "You're posting faster than DevTalk allows. Your draft is still here, so please try again in about 3 hours."],
  ])("explains when to retry after %s seconds", (seconds, message) => {
    const error = new PublishError("rate_limited", 429, "rate_limited", undefined, false, seconds);
    expect(publishErrorMessage(error, "x")).toBe(message);
  });
});
