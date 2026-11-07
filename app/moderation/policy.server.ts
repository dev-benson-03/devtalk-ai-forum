/**
 * DevTalk Safe-for-Work content policy, as code. The written policy, with
 * reasons and examples, is docs/architecture/content-policy.md. Change both
 * together and bump MODERATION_POLICY_VERSION.
 */

/** Stored on every forum and comment published under this policy. */
export const MODERATION_POLICY_VERSION = "sfw-2026-11-07";

/** Provider model (OpenAI Moderation API; free to use with the existing key). */
export const MODERATION_MODEL = "omni-moderation-latest";

/**
 * Why a submission was rejected. These codes are all a client ever sees:
 * no scores, provider category names or model output.
 */
export type PolicyReason =
  | "sexual"
  | "self_harm"
  | "profanity"
  | "hate_harassment"
  | "threat"
  | "graphic_violence"
  | "unsafe";

/**
 * Provider categories that reject a submission when the provider flags them
 * (the provider's own thresholds), and the reason shown for each.
 */
export const BLOCK_WHEN_FLAGGED: Readonly<Record<string, PolicyReason>> = {
  sexual: "sexual",
  "sexual/minors": "sexual",
  hate: "hate_harassment",
  harassment: "hate_harassment",
  "hate/threatening": "threat",
  "harassment/threatening": "threat",
  "violence/graphic": "graphic_violence",
  "illicit/violent": "unsafe",
};

/**
 * Categories that often fire on legitimate discussion (security research,
 * game violence, news, history). They reject only with high confidence.
 */
export const BLOCK_AT_HIGH_SCORE: Readonly<Record<string, PolicyReason>> = {
  violence: "graphic_violence",
  illicit: "unsafe",
};
export const HIGH_SCORE_THRESHOLD = 0.9;

/**
 * Self-harm is decided from the three self-harm categories together
 * (selfHarmDecision in moderation.server.ts; content-policy.md explains why):
 *
 *   1. Instructions ("self-harm/instructions" flagged, or its score at
 *      least SELF_HARM_INSTRUCTIONS_CAUTION) → reject, whatever else is
 *      flagged. Intent never makes method content acceptable.
 *   2. "self-harm" flagged without "self-harm/intent" → reject. Content
 *      that promotes, encourages or depicts self-harm and is not a personal
 *      disclosure; treated conservatively.
 *   3. "self-harm/intent" flagged (with or without "self-harm", at any
 *      score) and no instructions → allowed: a personal disclosure or a
 *      request for support. The author is shown a support message.
 *
 * Scores are classifier confidence, not a measure of anyone's personal
 * danger, and are never shown or stored.
 */
export const SELF_HARM_INSTRUCTIONS_CAUTION = 0.5;

/** When several reasons apply, the first in this list is reported. */
export const REASON_PRIORITY: readonly PolicyReason[] = [
  "threat",
  "self_harm",
  "sexual",
  "hate_harassment",
  "graphic_violence",
  "unsafe",
  "profanity",
];
