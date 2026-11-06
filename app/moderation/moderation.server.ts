/**
 * Server-side Safe-for-Work moderation (policy: policy.server.ts and
 * docs/architecture/content-policy.md). Independent of React and of the
 * routes: callers pass already-validated text and get a structured decision.
 *
 * Fails closed: if the provider is not configured, times out, errors or
 * answers in an unexpected shape, moderate() throws ModerationUnavailableError
 * and the caller must not publish.
 *
 * Nothing here logs. Callers log only the decision codes, never the text.
 */
import {
  BLOCK_AT_HIGH_SCORE,
  BLOCK_WHEN_FLAGGED,
  HIGH_SCORE_THRESHOLD,
  MODERATION_POLICY_VERSION,
  REASON_PRIORITY,
  type PolicyReason,
} from "./policy.server";
import { containsProfanity } from "./profanity.server";

/** One piece of publishable text, e.g. { name: "title", text: "..." }. */
export interface ModerationField {
  name: string;
  text: string;
}

export type ModerationDecision =
  | { allowed: true; policyVersion: string }
  | { allowed: false; policyVersion: string; reason: PolicyReason; field: string };

export type UnavailableReason = "not_configured" | "timeout" | "provider_error" | "invalid_response";

/** Moderation could not run; the content must not be published. */
export class ModerationUnavailableError extends Error {
  constructor(readonly reason: UnavailableReason) {
    super(`Moderation unavailable: ${reason}`);
    this.name = "ModerationUnavailableError";
  }
}

/** Sends the texts to the provider and returns its raw (untrusted) response. */
export type ModerationProvider = (inputs: string[]) => Promise<unknown>;

export interface Moderator {
  moderate(fields: ModerationField[]): Promise<ModerationDecision>;
}

/** Outer bound on one provider call, including the SDK's own retry. */
export const MODERATION_DEADLINE_MS = 12_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A flag the policy relies on. `null` is allowed only where the SDK documents it. */
const NULLABLE = new Set(["illicit", "illicit/violent"]);

/** Reasons the policy gives for one provider result, or null if its shape is wrong. */
function reasonsFor(result: unknown): PolicyReason[] | null {
  if (!isRecord(result) || typeof result.flagged !== "boolean") return null;
  const { categories, category_scores: scores } = result;
  if (!isRecord(categories) || !isRecord(scores)) return null;

  const reasons: PolicyReason[] = [];
  for (const [category, reason] of Object.entries(BLOCK_WHEN_FLAGGED)) {
    const flag = categories[category];
    if (flag === null && NULLABLE.has(category)) continue;
    if (typeof flag !== "boolean") return null;
    if (flag) reasons.push(reason);
  }
  for (const [category, reason] of Object.entries(BLOCK_AT_HIGH_SCORE)) {
    const score = scores[category];
    if (typeof score !== "number" || !Number.isFinite(score)) return null;
    if (score >= HIGH_SCORE_THRESHOLD) reasons.push(reason);
  }
  return reasons;
}

const firstReason = (reasons: PolicyReason[]) => REASON_PRIORITY.find((r) => reasons.includes(r)) ?? "unsafe";

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ModerationUnavailableError("timeout")), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const isTimeout = (error: unknown) =>
  error instanceof ModerationUnavailableError ||
  (isRecord(error) && /timeout/i.test(String(error.name ?? "")));

/**
 * @param provider null when no provider is configured (every call then
 *   throws ModerationUnavailableError("not_configured")).
 */
export function createModerator(provider: ModerationProvider | null, deadlineMs = MODERATION_DEADLINE_MS): Moderator {
  return {
    async moderate(fields) {
      const policyVersion = MODERATION_POLICY_VERSION;
      const toCheck = fields.filter((field) => field.text.trim() !== "");

      // Strong profanity is decided locally; the provider has no such category
      const profane = toCheck.find((field) => containsProfanity(field.text));
      if (profane) return { allowed: false, policyVersion, reason: "profanity", field: profane.name };
      if (toCheck.length === 0) return { allowed: true, policyVersion };

      if (!provider) throw new ModerationUnavailableError("not_configured");
      let response: unknown;
      try {
        response = await withDeadline(provider(toCheck.map((field) => field.text)), deadlineMs);
      } catch (error) {
        throw new ModerationUnavailableError(isTimeout(error) ? "timeout" : "provider_error");
      }

      const results = isRecord(response) ? response.results : undefined;
      if (!Array.isArray(results) || results.length !== toCheck.length) {
        throw new ModerationUnavailableError("invalid_response");
      }
      for (let i = 0; i < toCheck.length; i++) {
        const reasons = reasonsFor(results[i]);
        if (reasons === null) throw new ModerationUnavailableError("invalid_response");
        if (reasons.length > 0) {
          return { allowed: false, policyVersion, reason: firstReason(reasons), field: toCheck[i].name };
        }
      }
      return { allowed: true, policyVersion };
    },
  };
}
