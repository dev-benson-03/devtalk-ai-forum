/**
 * Input validation for POST /api/analyzeMessages. Pure and framework-free.
 *
 * Since Phase 2B the server reads the forum and its comments itself, so the
 * request carries only `forumId` and an optional `forceRegenerate` flag.
 * Anything else a client sends (messages, titles, user IDs) is ignored.
 */

export const ANALYZE_LIMITS = {
  /** Raw request body size. The body is now tiny; this is a hard outer cap. */
  maxBodyBytes: 512 * 1024,
  /** Newest trusted comments used for one analysis. */
  maxMessages: 500,
  /** Characters kept from one comment. */
  maxContentChars: 10_000,
  /** Characters across all comments, to bound OpenAI prompt size and cost. */
  maxTotalContentChars: 200_000,
} as const;

/** Firestore auto-IDs are 20 characters of [A-Za-z0-9]; allow a little more. */
const DOC_ID = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;

export interface AnalysisRequest {
  forumId: string;
  forceRegenerate: boolean;
}

export type InvalidReason = "invalid_json" | "invalid_body" | "invalid_forum_id" | "invalid_field" | "body_too_large";

export type ValidationResult =
  | { ok: true; value: AnalysisRequest }
  | { ok: false; status: 400 | 413; reason: InvalidReason };

const fail = (reason: InvalidReason, status: 400 | 413 = 400): ValidationResult => ({ ok: false, status, reason });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates a parsed JSON body and returns only the known fields. */
export function validateAnalysisRequest(body: unknown): ValidationResult {
  if (!isPlainObject(body)) return fail("invalid_body");
  if (typeof body.forumId !== "string" || !DOC_ID.test(body.forumId)) return fail("invalid_forum_id");
  const force = body.forceRegenerate;
  if (force !== undefined && typeof force !== "boolean") return fail("invalid_field");
  return { ok: true, value: { forumId: body.forumId, forceRegenerate: force === true } };
}

/** Reads and validates the request body, rejecting oversized or non-JSON bodies. */
export async function readAnalysisRequest(request: Request): Promise<ValidationResult> {
  const declared = Number(request.headers?.get?.("Content-Length") ?? 0);
  if (declared > ANALYZE_LIMITS.maxBodyBytes) return fail("body_too_large", 413);

  let text: string;
  try {
    text = await request.text();
  } catch {
    return fail("invalid_json");
  }
  if (new TextEncoder().encode(text).length > ANALYZE_LIMITS.maxBodyBytes) {
    return fail("body_too_large", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("invalid_json");
  }
  return validateAnalysisRequest(body);
}
