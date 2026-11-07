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
  SELF_HARM_INSTRUCTIONS_CAUTION,
  type PolicyReason,
} from "./policy.server";
import { containsProfanity } from "./profanity.server";

/** One piece of publishable text, e.g. { name: "title", text: "..." }. */
export interface ModerationField {
  name: string;
  text: string;
}

/**
 * `support`: show the author the support message (content-policy.md).
 * Set when a field reads as a personal self-harm disclosure, or when a
 * submission is rejected for self-harm content. It goes only to the
 * author's own response; it is never stored, logged or shown to others.
 */
export type ModerationDecision =
  | { allowed: true; policyVersion: string; support: boolean }
  | { allowed: false; policyVersion: string; reason: PolicyReason; field: string; support: boolean };

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

interface ResultReading {
  reasons: PolicyReason[];
  /** "self-harm/intent" flagged: a personal disclosure */
  disclosure: boolean;
}

const SELF_HARM_FLAGS = ["self-harm", "self-harm/intent", "self-harm/instructions"];
const SELF_HARM_SCORES = ["self-harm", "self-harm/intent", "self-harm/instructions"];

/** The self-harm rules of policy.server.ts, from the three categories together. */
function selfHarmDecision(categories: Record<string, unknown>, scores: Record<string, unknown>): ResultReading {
  const instructions =
    categories["self-harm/instructions"] === true ||
    (scores["self-harm/instructions"] as number) >= SELF_HARM_INSTRUCTIONS_CAUTION;
  const disclosure = categories["self-harm/intent"] === true;
  const promotion = categories["self-harm"] === true && !disclosure;
  return { reasons: instructions || promotion ? ["self_harm"] : [], disclosure };
}

/** What the policy reads from one provider result, or null if its shape is wrong. */
function readResult(result: unknown): ResultReading | null {
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
  // Every self-harm signal must be present and well-formed: no guessing
  if (SELF_HARM_FLAGS.some((c) => typeof categories[c] !== "boolean")) return null;
  if (SELF_HARM_SCORES.some((c) => typeof scores[c] !== "number" || !Number.isFinite(scores[c] as number))) return null;
  const selfHarm = selfHarmDecision(categories, scores);
  return { reasons: [...reasons, ...selfHarm.reasons], disclosure: selfHarm.disclosure };
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
      if (toCheck.length === 0) return { allowed: true, policyVersion, support: false };

      // Strong profanity is decided locally (the provider has no such
      // category). The provider still runs, so a profane post that also
      // discloses distress gets the support message.
      const profane = toCheck.find((field) => containsProfanity(field.text));
      const profanityOnly = () =>
        profane ? ({ allowed: false, policyVersion, reason: "profanity", field: profane.name, support: false } as const) : null;

      if (!provider) {
        const local = profanityOnly();
        if (local) return local; // rejected either way: nothing is published
        throw new ModerationUnavailableError("not_configured");
      }
      let readings: ResultReading[];
      try {
        const response = await withDeadline(provider(toCheck.map((field) => field.text)), deadlineMs);
        const results = isRecord(response) ? response.results : undefined;
        if (!Array.isArray(results) || results.length !== toCheck.length) {
          throw new ModerationUnavailableError("invalid_response");
        }
        const read = results.map(readResult);
        if (read.some((r) => r === null)) throw new ModerationUnavailableError("invalid_response");
        readings = read as ResultReading[];
      } catch (error) {
        const local = profanityOnly();
        if (local) return local;
        if (error instanceof ModerationUnavailableError && error.reason === "invalid_response") throw error;
        throw new ModerationUnavailableError(isTimeout(error) ? "timeout" : "provider_error");
      }

      const findings = toCheck.flatMap((field, i) => [
        ...readings[i].reasons.map((reason) => ({ field: field.name, reason })),
        ...(field === profane ? [{ field: field.name, reason: "profanity" as PolicyReason }] : []),
      ]);
      const disclosure = readings.some((r) => r.disclosure);
      if (findings.length === 0) return { allowed: true, policyVersion, support: disclosure };

      const reason = firstReason(findings.map((f) => f.reason));
      const field = findings.find((f) => f.reason === reason)!.field;
      return { allowed: false, policyVersion, reason, field, support: disclosure || reason === "self_harm" };
    },
  };
}
