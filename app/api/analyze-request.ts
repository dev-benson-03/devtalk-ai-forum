/**
 * Input validation for POST /api/analyzeMessages. Pure and framework-free.
 * Only known fields are copied into the result, so unexpected keys (such as
 * a client-supplied uid) never reach the handler.
 */

export const ANALYZE_LIMITS = {
  /** Raw body size. Well above the largest legitimate payload below. */
  maxBodyBytes: 512 * 1024,
  /** Comments sent for one forum. */
  maxMessages: 500,
  /** Characters in one comment. */
  maxContentChars: 10_000,
  /** Characters across all comments, to bound OpenAI prompt size and cost. */
  maxTotalContentChars: 200_000,
  /** Characters in any other text field (title, author, timestamp, ...). */
  maxTextChars: 2_000,
} as const;

/** Firestore auto-IDs are 20 characters of [A-Za-z0-9]; allow a little more. */
const DOC_ID = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;

export interface AnalysisMessage {
  id: string | number;
  content: string;
  author?: string;
  userName?: string;
  timestamp?: string;
  threadId?: string;
  forumId?: string;
  createdAt?: string | null | { seconds: number; nanoseconds: number; type?: string };
}

export interface AnalysisRequest {
  forumId: string;
  forumTitle?: string;
  forumDescription?: string;
  forumQuestion?: string;
  category?: string;
  messages: AnalysisMessage[];
}

export type InvalidReason =
  | "invalid_json"
  | "invalid_body"
  | "invalid_forum_id"
  | "invalid_field"
  | "invalid_messages"
  | "too_many_messages"
  | "invalid_message"
  | "message_too_long"
  | "content_too_long"
  | "body_too_large";

export type ValidationResult =
  | { ok: true; value: AnalysisRequest }
  | { ok: false; status: 400 | 413; reason: InvalidReason };

const fail = (reason: InvalidReason, status: 400 | 413 = 400): ValidationResult => ({ ok: false, status, reason });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isShortText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= ANALYZE_LIMITS.maxTextChars;

/** Copies optional text fields that are present; returns false if one is invalid. */
function copyOptionalText<K extends string>(
  source: Record<string, unknown>,
  keys: readonly K[],
  target: Partial<Record<K, string>>
): boolean {
  for (const key of keys) {
    if (source[key] === undefined) continue;
    if (!isShortText(source[key])) return false;
    target[key] = source[key];
  }
  return true;
}

/** A Firestore Timestamp serialized by JSON.stringify, a string, or null (pending write). */
function readCreatedAt(value: unknown): AnalysisMessage["createdAt"] | false {
  if (value === null || isShortText(value)) return value;
  if (!isPlainObject(value)) return false;
  const { seconds, nanoseconds, type } = value;
  const extraKeys = Object.keys(value).filter((k) => !["seconds", "nanoseconds", "type"].includes(k));
  if (extraKeys.length > 0 || !Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) return false;
  if (type !== undefined && !isShortText(type)) return false;
  return { seconds: seconds as number, nanoseconds: nanoseconds as number, ...(type ? { type } : {}) };
}

const MESSAGE_TEXT_FIELDS = ["author", "userName", "timestamp", "threadId", "forumId"] as const;

function readMessage(raw: unknown): AnalysisMessage | InvalidReason {
  if (!isPlainObject(raw)) return "invalid_message";
  const { id, content } = raw;
  const validId =
    (typeof id === "string" && DOC_ID.test(id)) || (Number.isSafeInteger(id) && (id as number) >= 0);
  if (!validId || typeof content !== "string") return "invalid_message";
  if (content.length > ANALYZE_LIMITS.maxContentChars) return "message_too_long";

  const message: AnalysisMessage = { id: id as string | number, content };
  if (!copyOptionalText(raw, MESSAGE_TEXT_FIELDS, message)) return "invalid_message";
  if (raw.createdAt !== undefined) {
    const createdAt = readCreatedAt(raw.createdAt);
    if (createdAt === false) return "invalid_message";
    message.createdAt = createdAt;
  }
  return message;
}

const FORUM_TEXT_FIELDS = ["forumTitle", "forumDescription", "forumQuestion", "category"] as const;

/** Validates a parsed JSON body and returns a clean copy of the known fields. */
export function validateAnalysisRequest(body: unknown): ValidationResult {
  if (!isPlainObject(body)) return fail("invalid_body");
  if (typeof body.forumId !== "string" || !DOC_ID.test(body.forumId)) return fail("invalid_forum_id");

  const value: AnalysisRequest = { forumId: body.forumId, messages: [] };
  if (!copyOptionalText(body, FORUM_TEXT_FIELDS, value)) return fail("invalid_field");

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) return fail("invalid_messages");
  if (messages.length > ANALYZE_LIMITS.maxMessages) return fail("too_many_messages");

  let totalChars = 0;
  for (const raw of messages) {
    const message = readMessage(raw);
    if (typeof message === "string") return fail(message);
    totalChars += message.content.length;
    if (totalChars > ANALYZE_LIMITS.maxTotalContentChars) return fail("content_too_long");
    value.messages.push(message);
  }
  return { ok: true, value };
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
