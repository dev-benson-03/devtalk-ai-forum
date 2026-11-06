import { PublishError, publishComment, publishErrorMessage, publishForum } from "../publish-client";

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
});
