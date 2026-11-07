/**
 * Input validation for POST /api/forums and POST /api/comments. Pure.
 *
 * Only the listed fields are accepted. Anything else (creatorId, userId,
 * isAdmin, isActive, commentCount, analysis fields, timestamps) makes the
 * request invalid: identity, ownership and server-controlled properties are
 * set by the server, never taken from the client.
 */
import { FORUM_CATEGORIES, FORUM_TIME_LIMITS, TEXT_LIMITS } from "../forum/forum-options";
import { readBoundedText } from "./bounded-body";

export const MAX_PUBLISH_BODY_BYTES = 32 * 1024;

/** crypto.randomUUID() format: one ID per draft, so retries can't publish twice. */
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DOC_ID = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;

export interface ForumRequest {
  title: string;
  description: string;
  question: string;
  category: string;
  timeLimitHours: number;
  anonymous: boolean;
  requestId: string;
}

export interface CommentRequest {
  forumId: string;
  content: string;
  anonymous: boolean;
  requestId: string;
}

export type InvalidReason =
  | "invalid_json"
  | "invalid_body"
  | "body_too_large"
  | "unreadable_body"
  | "unexpected_field"
  | "invalid_field";

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 413; reason: InvalidReason; field?: string };

const fail = <T>(reason: InvalidReason, field?: string, status: 400 | 413 = 400): Parsed<T> => ({
  ok: false,
  status,
  reason,
  ...(field ? { field } : {}),
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Trimmed text of 1..max characters, or null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
}

function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(body).find((key) => !allowed.includes(key)) ?? null;
}

const FORUM_KEYS = ["title", "description", "question", "category", "timeLimitHours", "anonymous", "requestId"];
const COMMENT_KEYS = ["forumId", "content", "anonymous", "requestId"];

export function validateForumRequest(body: unknown): Parsed<ForumRequest> {
  if (!isPlainObject(body)) return fail("invalid_body");
  const extra = onlyKeys(body, FORUM_KEYS);
  if (extra) return fail("unexpected_field");

  const title = text(body.title, TEXT_LIMITS.title);
  if (title === null) return fail("invalid_field", "title");
  const description = text(body.description, TEXT_LIMITS.description);
  if (description === null) return fail("invalid_field", "description");
  const question = text(body.question, TEXT_LIMITS.question);
  if (question === null) return fail("invalid_field", "question");
  const category = body.category;
  if (typeof category !== "string" || !(FORUM_CATEGORIES as readonly string[]).includes(category)) {
    return fail("invalid_field", "category");
  }
  const hours = body.timeLimitHours;
  if (typeof hours !== "number" || !FORUM_TIME_LIMITS.some((option) => option.hours === hours)) {
    return fail("invalid_field", "timeLimitHours");
  }
  if (typeof body.anonymous !== "boolean") return fail("invalid_field", "anonymous");
  if (typeof body.requestId !== "string" || !REQUEST_ID.test(body.requestId)) return fail("invalid_field", "requestId");

  return {
    ok: true,
    value: { title, description, question, category, timeLimitHours: hours, anonymous: body.anonymous, requestId: body.requestId },
  };
}

export function validateCommentRequest(body: unknown): Parsed<CommentRequest> {
  if (!isPlainObject(body)) return fail("invalid_body");
  if (onlyKeys(body, COMMENT_KEYS)) return fail("unexpected_field");
  if (typeof body.forumId !== "string" || !DOC_ID.test(body.forumId)) return fail("invalid_field", "forumId");
  const content = text(body.content, TEXT_LIMITS.content);
  if (content === null) return fail("invalid_field", "content");
  if (typeof body.anonymous !== "boolean") return fail("invalid_field", "anonymous");
  if (typeof body.requestId !== "string" || !REQUEST_ID.test(body.requestId)) return fail("invalid_field", "requestId");
  return { ok: true, value: { forumId: body.forumId, content, anonymous: body.anonymous, requestId: body.requestId } };
}

/**
 * Reads a small JSON body. The byte limit is enforced while the stream is
 * read (bounded-body.ts); an oversized body is never parsed.
 */
export async function readJsonBody(request: Request): Promise<Parsed<unknown>> {
  const read = await readBoundedText(request, MAX_PUBLISH_BODY_BYTES);
  if (!read.ok) {
    if (read.reason === "body_too_large") return fail("body_too_large", undefined, 413);
    return fail(read.reason === "invalid_encoding" ? "invalid_json" : "unreadable_body");
  }
  try {
    return { ok: true, value: JSON.parse(read.text) };
  } catch {
    return fail("invalid_json");
  }
}
