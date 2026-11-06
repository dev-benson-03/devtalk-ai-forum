/**
 * Server-only analysis cache in `analysisCache/{forumId}_{sha256}`.
 *
 * The digest covers everything that shapes the model's answer: the analysis
 * version, model settings, forum ID, the forum context in the prompt, and the
 * selected comments (id, thread, content) in prompt order, i.e. exactly the
 * model's input. A new comment, a change to a selected comment, or an edited
 * forum title/description/question/tag gives a new key, so the old entry is
 * never read again. Changes to comments outside the selection (see
 * selectForAnalysis) do not change the input and keep the key. Comment text
 * never appears in the key, only in the digest input.
 *
 * Only the Admin SDK reads or writes this collection. Entries are validated
 * again before they are served.
 */
import { createHash } from "crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { TrustedComment } from "./analysis-comments";
import { validateAnalysisText, type AnalysisText } from "./analysis-output";

/** Bump when the prompt, model settings or output validation change; old entries stop matching. */
export const ANALYSIS_VERSION = "phase2c-1";
export const ANALYSIS_MODEL = "gpt-4o-mini";
export const ANALYSIS_TEMPERATURE = 0.3;
export const CACHE_COLLECTION = "analysisCache";
/** Sets `expireAt` so a Firestore TTL policy can delete old entries (not enabled yet). */
export const CACHE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface ForumContext {
  title: string;
  description: string;
  question: string;
  category: string;
}

export interface AnalysisCounts {
  totalMessages: number;
  uniqueAuthors: number;
}

export function analysisCacheKey(forumId: string, context: ForumContext, comments: TrustedComment[]): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        version: ANALYSIS_VERSION,
        model: ANALYSIS_MODEL,
        temperature: ANALYSIS_TEMPERATURE,
        forumId,
        context,
        comments: comments.map((c) => [c.id, c.parentId ?? "", c.content]),
      })
    )
    .digest("hex");
  return `${forumId}_${digest}`;
}

export type CacheRead = { status: "hit"; analysis: AnalysisText } | { status: "miss" } | { status: "invalid" };

/** Reads an entry and serves it only if it belongs to this forum and version and still validates. */
export async function readCachedAnalysis(db: Firestore, key: string, forumId: string): Promise<CacheRead> {
  const snap = await cacheRef(db, key).get();
  if (!snap.exists) return { status: "miss" };
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const analysis = validateAnalysisText(data);
  if (data.forumId !== forumId || data.version !== ANALYSIS_VERSION || !analysis) return { status: "invalid" };
  return { status: "hit", analysis };
}

/**
 * The document stored for a validated analysis. Written by the route inside
 * the publish transaction (see publishGeneration), together with the forum
 * fields and the lock release. Counts are informational; responses recompute them.
 */
export function cacheEntry(forumId: string, analysis: AnalysisText, counts: AnalysisCounts, now = Date.now()) {
  return {
    forumId,
    version: ANALYSIS_VERSION,
    model: ANALYSIS_MODEL,
    summary: analysis.summary,
    actionRoadmap: analysis.actionRoadmap,
    ...counts,
    createdAt: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(now + CACHE_RETENTION_MS),
  };
}

export const cacheRef = (db: Firestore, key: string) => db.collection(CACHE_COLLECTION).doc(key);
