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
    expect(decision).toEqual({ allowed: true, policyVersion: MODERATION_POLICY_VERSION, support: false });
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
    ["self-harm instructions", { "self-harm/instructions": true }, "self_harm"],
  ])("rejects %s and names the field", async (_label, flags, reason) => {
    const provider = providerReturning(result(), result(flags), result());
    const decision = await createModerator(provider).moderate(forum("Fine title"));
    expect(decision).toEqual({ allowed: false, policyVersion: MODERATION_POLICY_VERSION, reason, field: "description", support: reason === "self_harm" });
  });

  it("rejects strong profanity found locally", async () => {
    const provider = providerReturning(result());
    const decision = await createModerator(provider).moderate([{ name: "content", text: "This is F.U.C.K.I.N.G slow" }]);
    expect(decision).toEqual({ allowed: false, policyVersion: MODERATION_POLICY_VERSION, reason: "profanity", field: "content", support: false });
  });

  it("still rejects profanity when the provider is down or not configured", async () => {
    const text = [{ name: "content", text: "This is fucking slow" }];
    expect(await createModerator(null).moderate(text)).toMatchObject({ allowed: false, reason: "profanity" });
    const failing = jest.fn(async () => Promise.reject(new Error("503")));
    expect(await createModerator(failing).moderate(text)).toMatchObject({ allowed: false, reason: "profanity" });
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
    ["a missing self-harm/intent flag", { results: [{ ...result(), categories: { ...result().categories, "self-harm/intent": undefined } }] }],
    ["a null self-harm/instructions flag", { results: [{ ...result(), categories: { ...result().categories, "self-harm/instructions": null } }] }],
    ["a missing self-harm/instructions score", { results: [{ ...result(), category_scores: { ...result().category_scores, "self-harm/instructions": undefined } }] }],
    ["a NaN self-harm score", { results: [{ ...result(), category_scores: { ...result().category_scores, "self-harm": NaN } }] }],
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

/**
 * Self-harm rules (policy.server.ts, content-policy.md). Texts are short
 * synthetic stand-ins; the provider result decides, not the wording.
 */
describe("self-harm decisions", () => {
  const one = (r: unknown, text = "x") => createModerator(providerReturning(r)).moderate([{ name: "content", text }]);
  const allowedWithSupport = { allowed: true, policyVersion: MODERATION_POLICY_VERSION, support: true };
  const rejectedSelfHarm = { allowed: false, policyVersion: MODERATION_POLICY_VERSION, reason: "self_harm", field: "content", support: true };

  it("allows a personal disclosure (intent alone) and asks for the support message", async () => {
    expect(await one(result({ "self-harm/intent": true }))).toEqual(allowedWithSupport);
  });

  it("allows intent together with a high self-harm score", async () => {
    const r = result({ "self-harm": true, "self-harm/intent": true }, { "self-harm": 0.98, "self-harm/intent": 0.9 });
    expect(await one(r)).toEqual(allowedWithSupport);
  });

  it("rejects intent together with flagged instructions", async () => {
    expect(await one(result({ "self-harm/intent": true, "self-harm/instructions": true }))).toEqual(rejectedSelfHarm);
  });

  it("rejects intent with an unflagged instructions score at the caution level", async () => {
    const r = result({ "self-harm": true, "self-harm/intent": true }, { "self-harm/instructions": 0.5 });
    expect(await one(r)).toEqual(rejectedSelfHarm);
  });

  it("allows an instructions score just below the caution level", async () => {
    const r = result({ "self-harm/intent": true }, { "self-harm/instructions": 0.49 });
    expect(await one(r)).toEqual(allowedWithSupport);
  });

  it("rejects instructions without intent", async () => {
    expect(await one(result({ "self-harm/instructions": true }))).toEqual(rejectedSelfHarm);
  });

  it("rejects self-harm flagged without intent (promotion, encouragement, depiction)", async () => {
    expect(await one(result({ "self-harm": true }))).toEqual(rejectedSelfHarm);
  });

  it("allows educational, preventive and recovery discussion the provider does not flag", async () => {
    const texts = [
      "Our crisis-line app should show 988 prominently; how do we test that flow?",
      "Two years into recovery, pairing with a mentor kept me going. Happy to talk.",
      "Clinical NLP: detecting suicidal ideation in notes without storing PHI.",
    ];
    for (const text of texts) {
      const r = result({}, { "self-harm": 0.2, "self-harm/intent": 0.1, "self-harm/instructions": 0.01 });
      expect(await one(r, text)).toEqual({ allowed: true, policyVersion: MODERATION_POLICY_VERSION, support: false });
    }
  });

  it("rejects a support request that is also harassment, and still shows the support message", async () => {
    const r = result({ "self-harm/intent": true, harassment: true });
    expect(await one(r)).toEqual({ ...rejectedSelfHarm, reason: "hate_harassment" });
  });

  it("reports a threat ahead of self-harm (e.g. telling someone to hurt themselves)", async () => {
    const r = result({ "harassment/threatening": true, harassment: true, "self-harm": true });
    // Aimed at someone else, with no disclosure: no support message for the author
    expect(await one(r)).toMatchObject({ allowed: false, reason: "threat", support: false });
  });

  it("reports self-harm ahead of sexual, hate and profanity", async () => {
    const r = result({ "self-harm/instructions": true, sexual: true, hate: true });
    expect(await one(r, "fucking")).toMatchObject({ allowed: false, reason: "self_harm" });
  });

  it("names the field that carries the highest-priority reason", async () => {
    const provider = providerReturning(result({ sexual: true }), result({ "self-harm": true }), result());
    expect(await createModerator(provider).moderate(forum("t"))).toMatchObject({ reason: "self_harm", field: "description" });
  });

  it("shows the support message to a profane post that also discloses distress", async () => {
    expect(await one(result({ "self-harm/intent": true }), "I feel like shit and want to die")).toMatchObject({
      allowed: false,
      reason: "profanity",
      support: true,
    });
  });

  it("does not ask for the support message for other rejections", async () => {
    expect(await one(result({ hate: true }))).toMatchObject({ allowed: false, support: false });
    expect(await one(result({ "violence/graphic": true }))).toMatchObject({ allowed: false, support: false });
  });

  it("does not ask for the support message when only lower self-harm scores are present", async () => {
    const r = result({}, { "self-harm": 0.45, "self-harm/intent": 0.45, "self-harm/instructions": 0.3 });
    expect(await one(r)).toEqual({ allowed: true, policyVersion: MODERATION_POLICY_VERSION, support: false });
  });

  it("fails closed rather than guessing when self-harm signals are malformed", async () => {
    const r = result({ "self-harm/intent": true });
    const broken = { ...r, categories: { ...r.categories, "self-harm/instructions": "false" } };
    const error = await one(broken).catch((e) => e);
    expect(error).toBeInstanceOf(ModerationUnavailableError);
    expect(error.reason).toBe("invalid_response");
  });
});
