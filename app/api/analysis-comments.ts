/**
 * Shapes trusted comment documents (read with the Admin SDK) for analysis.
 * Comment fields as written by useFirestore.createComment: forumId, userId
 * (a UID, or "anonymous" when nobody was signed in), userName (display name
 * or "Anonymous User"), content, createdAt, and an optional parentId.
 */
import { ANALYZE_LIMITS } from "./analyze-request";

export interface TrustedComment {
  id: string;
  content: string;
  userId?: string;
  userName?: string;
  /** Thread key; the old API grouped by threadId, the schema declares parentId. */
  parentId?: string;
  createdAtMs: number;
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

function millis(value: unknown): number {
  const toMillis = (value as { toMillis?: unknown } | null)?.toMillis;
  return typeof toMillis === "function" ? Number(toMillis.call(value)) || 0 : 0;
}

/** Copies only the fields analysis needs; anything else in the doc is ignored. */
export function toTrustedComment(id: string, data: Record<string, unknown>): TrustedComment {
  return {
    id,
    content: typeof data.content === "string" ? data.content : "",
    userId: str(data.userId),
    userName: str(data.userName),
    parentId: str(data.parentId),
    createdAtMs: millis(data.createdAt),
  };
}

const ANONYMOUS_NAME = "anonymous user";

/**
 * Stable author key: the UID when present, else (legacy comments) the
 * normalized display name. Signed-out "anonymous" comments and generic
 * "Anonymous User" names identify nobody, so they return null.
 */
export function authorKey(comment: TrustedComment): string | null {
  if (comment.userId && comment.userId !== "anonymous") return `uid:${comment.userId}`;
  const name = comment.userName?.trim().toLowerCase();
  if (name && name !== ANONYMOUS_NAME) return `name:${name}`;
  return null;
}

/** Distinct identifiable authors. Comments with no identifiable author are not counted. */
export function countUniqueAuthors(comments: TrustedComment[]): number {
  const keys = new Set<string>();
  for (const comment of comments) {
    const key = authorKey(comment);
    if (key) keys.add(key);
  }
  return keys.size;
}

/**
 * Oldest-first, capped to the newest maxMessages comments, each truncated to
 * maxContentChars, then dropping the oldest until the total fits
 * maxTotalContentChars. Bounds prompt size and OpenAI cost.
 */
export function selectForAnalysis(comments: TrustedComment[]): TrustedComment[] {
  const sorted = [...comments].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const recent = sorted.slice(-ANALYZE_LIMITS.maxMessages).map((comment) => ({
    ...comment,
    content: comment.content.slice(0, ANALYZE_LIMITS.maxContentChars),
  }));
  let total = recent.reduce((sum, c) => sum + c.content.length, 0);
  while (total > ANALYZE_LIMITS.maxTotalContentChars && recent.length > 0) {
    total -= recent.shift()!.content.length;
  }
  return recent;
}
