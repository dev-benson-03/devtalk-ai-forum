/**
 * @jest-environment node
 *
 * The moderation service with a mocked provider. Synthetic content only;
 * no real OpenAI calls.
 */
import { createModerator, ModerationUnavailableError, type ModerationProvider } from "../moderation.server";
import { MODERATION_POLICY_VERSION } from "../policy.server";

const CATEGORIES = [
  "sexual",
  "sexual/minors",
  "hate",
  "hate/threatening",
  "harassment",
  "harassment/threatening",
  "violence",
  "violence/graphic",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "illicit",
  "illicit/violent",
];

/** A provider result in the Moderation API's shape. */
function result(flags: Record<string, boolean> = {}, scores: Record<string, number> = {}) {
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, flags[c] ?? false]));
  const category_scores = Object.fromEntries(CATEGORIES.map((c) => [c, scores[c] ?? (flags[c] ? 0.95 : 0.001)]));
  return { flagged: Object.values(flags).some(Boolean), categories, category_scores };
}

const providerReturning = (...results: unknown[]) =>
  jest.fn<Promise<unknown>, [string[]]>(async () => ({ id: "modr-1", model: "omni-moderation-latest", results }));

const forum = (title: string, description = "Description", question = "Question?") => [
  { name: "title", text: title },
  { name: "description", text: description },
  { name: "question", text: question },
];

describe("moderate", () => {
  it("approves a safe forum and sends each field to the provider", async () => {
    const provider = providerReturning(result(), result(), result());
    const decision = await createModerator(provider).moderate(forum("Best React state library?"));
    expect(decision).toEqual({ allowed: true, policyVersion: MODERATION_POLICY_VERSION });
    expect(provider).toHaveBeenCalledWith(["Best React state library?", "Description", "Question?"]);
  });

  it("approves a safe comment", async () => {
    const decision = await createModerator(providerReturning(result())).moderate([
      { name: "content", text: "I disagree, Zustand is simpler for this case." },
    ]);
    expect(decision.allowed).toBe(true);
  });

  it.each([
    ["sexual", { sexual: true }, "sexual"],
    ["sexual/minors", { "sexual/minors": true }, "sexual"],
    ["harassment", { harassment: true }, "hate_harassment"],
    ["hate", { hate: true }, "hate_harassment"],
    ["a threat", { "harassment/threatening": true, harassment: true }, "threat"],
    ["graphic violence", { "violence/graphic": true }, "graphic_violence"],
    ["self-harm instructions", { "self-harm/instructions": true }, "unsafe"],
  ])("rejects %s and names the field", async (_label, flags, reason) => {
    const provider = providerReturning(result(), result(flags), result());
    const decision = await createModerator(provider).moderate(forum("Fine title"));
    expect(decision).toEqual({ allowed: false, policyVersion: MODERATION_POLICY_VERSION, reason, field: "description" });
  });

  it("rejects strong profanity locally, without calling the provider", async () => {
    const provider = providerReturning();
    const decision = await createModerator(provider).moderate([{ name: "content", text: "This is F.U.C.K.I.N.G slow" }]);
    expect(decision).toMatchObject({ allowed: false, reason: "profanity", field: "content" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("accepts benign educational and clinical terminology that the provider does not flag", async () => {
    const text = "Sex education apps must handle HIV status, breast cancer screening and anatomy terms safely.";
    expect((await createModerator(providerReturning(result())).moderate([{ name: "content", text }])).allowed).toBe(true);
  });

  it("does not reject lower-confidence violence, illicit or self-harm scores", async () => {
    const flagged = result({ violence: true, illicit: true }, { violence: 0.6, illicit: 0.7, "self-harm": 0.5 });
    const decision = await createModerator(providerReturning(flagged)).moderate([
      { name: "content", text: "The game's boss fight kills you in one hit; also how do pen-testers use Metasploit?" },
    ]);
    expect(decision.allowed).toBe(true);
  });

  it("rejects high-confidence violence or illicit content", async () => {
    const provider = providerReturning(result({ illicit: true }, { illicit: 0.97 }));
    expect(await createModerator(provider).moderate([{ name: "content", text: "x" }])).toMatchObject({
      allowed: false,
      reason: "unsafe",
    });
  });

  it("does not block self-harm intent (support, not rejection)", async () => {
    const provider = providerReturning(result({ "self-harm/intent": true }));
    expect((await createModerator(provider).moderate([{ name: "content", text: "x" }])).allowed).toBe(true);
  });

  it("skips empty fields", async () => {
    const provider = providerReturning(result());
    await createModerator(provider).moderate([
      { name: "title", text: "  " },
      { name: "content", text: "Hi" },
    ]);
    expect(provider).toHaveBeenCalledWith(["Hi"]);
  });
});

describe("moderate fails closed", () => {
  const unavailable = async (moderator: ReturnType<typeof createModerator>, reason: string) => {
    const error = await moderator.moderate([{ name: "content", text: "Hello" }]).catch((e) => e);
    expect(error).toBeInstanceOf(ModerationUnavailableError);
    expect(error.reason).toBe(reason);
  };

  it("when no provider is configured", async () => {
    await unavailable(createModerator(null), "not_configured");
  });

  it("when the provider errors", async () => {
    await unavailable(createModerator(jest.fn(async () => Promise.reject(new Error("503")))), "provider_error");
  });

  it("when the provider's SDK times out", async () => {
    const timeout = Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
    await unavailable(createModerator(jest.fn(async () => Promise.reject(timeout))), "timeout");
  });

  it("when the provider never answers within the deadline", async () => {
    const hanging: ModerationProvider = () => new Promise(() => {});
    await unavailable(createModerator(hanging, 20), "timeout");
  });

  it.each([
    ["no response", undefined],
    ["no results", { results: [] }],
    ["too few results", { results: [] }],
    ["a result without categories", { results: [{ flagged: false, category_scores: {} }] }],
    ["a missing category", { results: [{ ...result(), categories: { sexual: false } }] }],
    ["a non-boolean flag", { results: [{ ...result(), categories: { ...result().categories, hate: "no" } }] }],
    ["a missing score", { results: [{ ...result(), category_scores: { violence: 0.1 } }] }],
    ["a non-numeric score", { results: [{ ...result(), category_scores: { ...result().category_scores, illicit: "0.1" } }] }],
    ["a missing flagged field", { results: [{ categories: result().categories, category_scores: result().category_scores }] }],
  ])("when the provider returns %s", async (_label, response) => {
    await unavailable(createModerator(jest.fn(async () => response)), "invalid_response");
  });

  it("accepts null illicit flags, as the SDK documents", async () => {
    const r = result();
    const provider = jest.fn(async () => ({ results: [{ ...r, categories: { ...r.categories, illicit: null, "illicit/violent": null } }] }));
    expect((await createModerator(provider).moderate([{ name: "content", text: "Hello" }])).allowed).toBe(true);
  });
});
