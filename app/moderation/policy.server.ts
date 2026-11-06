/**
 * DevTalk Safe-for-Work content policy, as code. The written policy, with
 * reasons and examples, is docs/architecture/content-policy.md. Change both
 * together and bump MODERATION_POLICY_VERSION.
 */

/** Stored on every forum and comment published under this policy. */
export const MODERATION_POLICY_VERSION = "sfw-2026-11-06";

/** Provider model (OpenAI Moderation API; free to use with the existing key). */
export const MODERATION_MODEL = "omni-moderation-latest";

/**
 * Why a submission was rejected. These codes are all a client ever sees:
 * no scores, provider category names or model output.
 */
export type PolicyReason =
  | "sexual"
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
  "self-harm/instructions": "unsafe",
  "illicit/violent": "unsafe",
};

/**
 * Categories that often fire on legitimate discussion (security research,
 * game violence, news, history). They reject only with high confidence.
 */
export const BLOCK_AT_HIGH_SCORE: Readonly<Record<string, PolicyReason>> = {
  violence: "graphic_violence",
  illicit: "unsafe",
  "self-harm": "unsafe",
};
export const HIGH_SCORE_THRESHOLD = 0.9;

/**
 * Not blocked: "self-harm/intent". A person saying they are struggling
 * should not get a rejection message. See the policy doc's open questions.
 */

/** When several reasons apply, the first in this list is reported. */
export const REASON_PRIORITY: readonly PolicyReason[] = [
  "threat",
  "sexual",
  "hate_harassment",
  "graphic_violence",
  "unsafe",
  "profanity",
];
