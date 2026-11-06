/**
 * api/analyzeMessages.ts
 * POST handler that analyzes a forum's comments using the OpenAI API.
 *
 * Flow: authenticate (Firebase ID token) → validate { forumId, forceRegenerate }
 * → per-user request limit → load the forum and its comments with the Admin
 * SDK → authorize → cache read → generation gate (lock, cooldown, quotas) →
 * OpenAI → strict validation → cache + approved forum fields. Nothing from the
 * client except forumId and forceRegenerate is used.
 * See docs/architecture/ai-analysis.md.
 */

import OpenAI from "openai";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser, type AuthenticatedUser } from "../auth/authenticate.server";
import { canForceRegenerate, canViewForum } from "../auth/forum-access";
import { getAdminDb } from "../firebase/admin.server";
import {
  ANALYSIS_MODEL,
  ANALYSIS_TEMPERATURE,
  analysisCacheKey,
  readCachedAnalysis,
  writeCachedAnalysis,
  type AnalysisCounts,
  type ForumContext,
} from "./analysis-cache.server";
import { countUniqueAuthors, selectForAnalysis, toTrustedComment, type TrustedComment } from "./analysis-comments";
import {
  LimitStoreError,
  acquireGeneration,
  consumeUserRequest,
  finishGeneration,
} from "./analysis-limits.server";
import { parseModelAnalysis, type AnalysisText } from "./analysis-output";
import { readAnalysisRequest } from "./analyze-request";

interface MessageAnalysisResponse {
  totalMessages: number;
  uniqueAuthors: number;
  summary: string;
  actionRoadmap: string[];
}

// OpenAI client setup
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
/** Bounded so a call always ends well inside the generation lock's TTL (2 min). */
const OPENAI_TIMEOUT_MS = 30_000;
const OPENAI_MAX_RETRIES = 1;

/** Upper bound on comment docs read for one forum (Firestore read cost). */
const MAX_COMMENT_READS = 2_000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** Structured diagnostics: ids, counts, statuses and safe codes only. */
function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  console[level]("[analyzeMessages]", { event, ...fields });
}

/** gRPC codes Firestore uses for transient failures: DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, UNAVAILABLE. */
const TRANSIENT_FIRESTORE_CODES = new Set([4, 8, 14]);

function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "number") return `firestore/${code}`;
  return typeof code === "string" && /^[a-z]+\/[a-z0-9-]{1,64}$/.test(code) ? code : "unknown";
}

function dataErrorResponse(error: unknown): Response {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" && TRANSIENT_FIRESTORE_CODES.has(code)
    ? json({ error: "Service unavailable" }, 503)
    : json({ error: "Internal server error" }, 500);
}

const retryAfterSeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** 429 / 409 with a Retry-After header (seconds). */
function retryLater(status: 409 | 429, error: string, reason: string, retryAfterMs: number): Response {
  const seconds = retryAfterSeconds(retryAfterMs);
  return json({ error, reason, retryAfterSeconds: seconds }, status, { "Retry-After": String(seconds) });
}

/** Rate-limit storage is down: refuse rather than generate without limits. */
function limitsUnavailable(forumId: string | null, error: unknown): Response {
  const cause = error instanceof LimitStoreError ? error.cause : error;
  log("error", "rate_limit_unavailable", { forumId, status: 503, code: safeErrorCode(cause) });
  return json({ error: "Service unavailable", reason: "rate_limit_unavailable" }, 503, { "Retry-After": "30" });
}

async function authenticate(request: Request): Promise<AuthenticatedUser | Response> {
  try {
    return await requireUser(request);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

/** Groups comments by thread for hierarchical analysis (no parentId → "main"). */
function buildThreadSummaries(comments: TrustedComment[]): string[] {
  const byThread = new Map<string, TrustedComment[]>();
  for (const comment of comments) {
    const threadKey = comment.parentId || "main";
    if (!byThread.has(threadKey)) byThread.set(threadKey, []);
    byThread.get(threadKey)!.push(comment);
  }
  const threadSummaries: string[] = [];
  for (const [threadKey, threadComments] of byThread) {
    threadSummaries.push(`Thread "${threadKey}": ${threadComments.map((c) => c.content).join("\n")}`);
  }
  return threadSummaries;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Forum context from the trusted forum document. */
const forumContextOf = (forum: Record<string, unknown>): ForumContext => ({
  title: text(forum.title),
  description: text(forum.description),
  question: text(forum.question),
  category: Array.isArray(forum.tags) ? text(forum.tags[0]) : "",
});

function buildPrompt(ctx: ForumContext, threadSummaries: string[]): string {
  const forumContext = ctx.title
    ? `Forum: "${ctx.title}"${ctx.description ? `\nDescription: ${ctx.description}` : ''}${ctx.question ? `\nQuestion: ${ctx.question}` : ''}${ctx.category ? `\nCategory: ${ctx.category}` : ''}\n\n`
    : '';
  return `
${forumContext}Perform hierarchical analysis:
1. Analyze each thread's diction, tone, structure, and emotional intent
2. Synthesize into forum-level summary with Gen Z-friendly insights
3. Create actionable 3-step roadmap

Threads:
${threadSummaries.join('\n\n')}

Return JSON: {"summary": "...", "actionRoadmap": ["1️⃣ ...", "2️⃣ ...", "3️⃣ ..."]}`;
}

export async function action({ request }: { request: Request }): Promise<Response> {
  const started = Date.now();
  const elapsedMs = () => Date.now() - started;
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // 1. Authentication comes first: no forum data or OpenAI without a valid token
  const user = await authenticate(request);
  if (user instanceof Response) {
    log("warn", "auth_failed", { status: user.status, elapsedMs: elapsedMs() });
    return user;
  }

  // 2. Validate the small request body
  const parsed = await readAnalysisRequest(request);
  if (!parsed.ok) {
    log("warn", "invalid_request", { status: parsed.status, reason: parsed.reason });
    const error = parsed.status === 413 ? "Request too large" : "Invalid request";
    return json({ error, reason: parsed.reason }, parsed.status);
  }
  const { forumId, forceRegenerate } = parsed.value;

  // 3. Per-user request limit (verified UID), before any forum or comment reads
  let db: Firestore;
  try {
    db = getAdminDb();
    const allowed = await consumeUserRequest(db, user.uid);
    if (!allowed.ok) {
      log("warn", "rate_limited", { forumId, status: 429, scope: allowed.scope });
      return retryLater(429, "Too many requests", allowed.scope, allowed.retryAfterMs);
    }
  } catch (error) {
    return limitsUnavailable(forumId, error);
  }

  // 4. Load trusted forum data and authorize
  let comments: TrustedComment[];
  let forum: Record<string, unknown>;
  try {
    const forumSnap = await db.collection("forums").doc(forumId).get();
    if (!forumSnap.exists) {
      log("warn", "forum_not_found", { forumId, status: 404 });
      return json({ error: "Forum not found" }, 404);
    }
    forum = forumSnap.data() ?? {};
    if (!canViewForum(user, forum) || (forceRegenerate && !canForceRegenerate(user, forum))) {
      log("warn", "forbidden", { forumId, status: 403, forceRegenerate });
      return json({ error: "Forbidden" }, 403);
    }
    const commentSnap = await db
      .collection("comments")
      .where("forumId", "==", forumId)
      .limit(MAX_COMMENT_READS)
      .get();
    comments = commentSnap.docs.map((d) => toTrustedComment(d.id, d.data()));
  } catch (error) {
    log("error", "data_load_failed", { forumId, code: safeErrorCode(error), elapsedMs: elapsedMs() });
    return dataErrorResponse(error);
  }

  if (comments.length === 0) {
    log("info", "no_comments", { forumId, status: 422 });
    return json({ error: "No comments to analyze", reason: "no_comments" }, 422);
  }

  try {
    return await analyze({ db, uid: user.uid, forumId, forum, allComments: comments, forceRegenerate, elapsedMs });
  } catch (error) {
    log("error", "analysis_failed", { forumId, code: safeErrorCode(error), elapsedMs: elapsedMs() });
    return json({ error: "Internal server error" }, 500);
  }
}

interface AnalyzeInput {
  db: Firestore;
  uid: string;
  forumId: string;
  forum: Record<string, unknown>;
  allComments: TrustedComment[];
  forceRegenerate: boolean;
  elapsedMs: () => number;
}

async function analyze(input: AnalyzeInput): Promise<Response> {
  const { db, uid, forumId, forum, allComments, forceRegenerate, elapsedMs } = input;
  const comments = selectForAnalysis(allComments);
  // Counts always come from the current comments, also when serving a cached analysis
  const counts: AnalysisCounts = { totalMessages: allComments.length, uniqueAuthors: countUniqueAuthors(allComments) };
  const context = forumContextOf(forum);
  const cacheKey = analysisCacheKey(forumId, context, comments);
  const keyRef = cacheKey.slice(-12); // digest suffix for correlating logs
  const respond = (analysis: AnalysisText, source: string) => {
    log("info", "analysis_complete", { forumId, status: 200, source, keyRef, ...counts, elapsedMs: elapsedMs() });
    const response: MessageAnalysisResponse = { ...counts, ...analysis };
    return json(response);
  };

  // 5. Unchanged content: serve the cached analysis (a forced refresh skips this)
  if (!forceRegenerate) {
    try {
      const cached = await readCachedAnalysis(db, cacheKey, forumId);
      if (cached.status === "hit") return respond(cached.analysis, "cache");
      if (cached.status === "invalid") log("warn", "cache_invalid", { forumId, keyRef });
    } catch (cacheError) {
      log("warn", "cache_check_failed", { forumId, code: safeErrorCode(cacheError) });
    }
  }

  if (!OPENAI_API_KEY) {
    log("error", "openai_not_configured", { forumId, status: 500 });
    return json({ error: "OpenAI API key not configured" }, 500);
  }

  // 6. Generation gate: one generation per forum at a time, cooldown, quotas
  let gate;
  try {
    gate = await acquireGeneration(db, { forumId, uid, key: cacheKey });
  } catch (error) {
    return limitsUnavailable(forumId, error);
  }
  if (gate.kind === "in_progress") {
    log("info", "generation_in_progress", { forumId, status: 409 });
    return retryLater(409, "Analysis in progress", "in_progress", gate.retryAfterMs);
  }
  if (gate.kind === "limited") {
    log("warn", "rate_limited", { forumId, status: 429, scope: gate.scope });
    return retryLater(429, "Too many requests", gate.scope, gate.retryAfterMs);
  }
  if (gate.kind === "cooldown") {
    // Content changed during the cooldown: keep showing the latest valid analysis
    if (!forceRegenerate && gate.previousKey) {
      try {
        const previous = await readCachedAnalysis(db, gate.previousKey, forumId);
        if (previous.status === "hit") return respond(previous.analysis, "previous");
      } catch (cacheError) {
        log("warn", "cache_check_failed", { forumId, code: safeErrorCode(cacheError) });
      }
    }
    log("warn", "rate_limited", { forumId, status: 429, scope: "forum_cooldown" });
    return retryLater(429, "Too many requests", "forum_cooldown", gate.retryAfterMs);
  }
  if (gate.recoveredStaleLock) log("warn", "stale_lock_recovered", { forumId });

  // 7. OpenAI, outside any transaction; the lock is always released afterwards
  let succeeded = false;
  try {
    const threadSummaries = buildThreadSummaries(comments);
    log("info", "openai_request", {
      forumId,
      keyRef,
      totalMessages: counts.totalMessages,
      analyzedMessages: comments.length,
      threads: threadSummaries.length,
      forceRegenerate,
    });
    let aiResponse = "";
    try {
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: OPENAI_TIMEOUT_MS, maxRetries: OPENAI_MAX_RETRIES });
      const completion = await openai.chat.completions.create({
        model: ANALYSIS_MODEL,
        messages: [{ role: "user", content: buildPrompt(context, threadSummaries) }],
        temperature: ANALYSIS_TEMPERATURE,
      });
      aiResponse = completion.choices[0]?.message?.content || "";
    } catch (openaiError) {
      log("error", "openai_failed", { forumId, code: safeErrorCode(openaiError), elapsedMs: elapsedMs() });
      return json({ error: "Analysis unavailable", reason: "upstream_error" }, 502);
    }

    const analysis = parseModelAnalysis(aiResponse);
    log(analysis ? "info" : "warn", analysis ? "openai_parsed" : "openai_invalid_output", {
      forumId,
      responseLength: aiResponse.length,
      elapsedMs: elapsedMs(),
    });
    // Invalid output is never cached, saved or replaced with made-up text; the client may retry
    if (!analysis) return json({ error: "Analysis unavailable", reason: "invalid_model_output" }, 502);

    // 8. Persist: validated cache entry, then only the approved forum fields
    try {
      await writeCachedAnalysis(db, cacheKey, forumId, analysis, counts);
    } catch (cacheError) {
      log("error", "cache_write_failed", { forumId, code: safeErrorCode(cacheError) });
    }
    try {
      await db.collection("forums").doc(forumId).update({
        analysisSummary: analysis.summary,
        actionRoadmap: analysis.actionRoadmap,
        lastAnalyzedAt: new Date().toISOString(),
      });
      log("info", "forum_updated", { forumId });
    } catch (updateError) {
      log("error", "forum_update_failed", { forumId, code: safeErrorCode(updateError) });
    }
    succeeded = true;
    return respond(analysis, "generated");
  } finally {
    try {
      await finishGeneration(db, { forumId, holder: gate.holder, key: cacheKey, succeeded });
    } catch (releaseError) {
      // The lock expires on its own after its TTL
      const cause = releaseError instanceof LimitStoreError ? releaseError.cause : releaseError;
      log("error", "lock_release_failed", { forumId, code: safeErrorCode(cause) });
    }
  }
}
