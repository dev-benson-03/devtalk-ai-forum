/**
 * api/analyzeMessages.ts
 * POST handler that analyzes a forum's comments using the OpenAI API.
 *
 * Flow: authenticate (Firebase ID token) → validate { forumId, forceRegenerate }
 * → load the forum and its comments with the Admin SDK → authorize → cache
 * read → OpenAI → persist approved analysis fields. Nothing from the client
 * except forumId and forceRegenerate is used.
 */

import { createHash } from "crypto";
import OpenAI from "openai";
import { requireUser, type AuthenticatedUser } from "../auth/authenticate.server";
import { canForceRegenerate, canViewForum } from "../auth/forum-access";
import { getAdminDb } from "../firebase/admin.server";
import { countUniqueAuthors, selectForAnalysis, toTrustedComment, type TrustedComment } from "./analysis-comments";
import { parseModelAnalysis } from "./analysis-output";
import { readAnalysisRequest } from "./analyze-request";

interface MessageAnalysisResponse {
  totalMessages: number;
  uniqueAuthors: number;
  summary: string;
  actionRoadmap: string[];
}

// OpenAI client setup
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/** Upper bound on comment docs read for one forum (Firestore read cost). */
const MAX_COMMENT_READS = 2_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

  // 3. Load trusted forum data and authorize
  let comments: TrustedComment[];
  let forum: Record<string, unknown>;
  try {
    const db = getAdminDb();
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
  if (!OPENAI_API_KEY) {
    log("error", "openai_not_configured", { forumId, status: 500 });
    return json({ error: "OpenAI API key not configured" }, 500);
  }

  try {
    return await analyze(forumId, forum, comments, forceRegenerate, elapsedMs);
  } catch (error) {
    log("error", "analysis_failed", { forumId, code: safeErrorCode(error), elapsedMs: elapsedMs() });
    return json({ error: "Internal server error" }, 500);
  }
}

async function analyze(
  forumId: string,
  forum: Record<string, unknown>,
  allComments: TrustedComment[],
  forceRegenerate: boolean,
  elapsedMs: () => number
): Promise<Response> {
  const db = getAdminDb();
  const comments = selectForAnalysis(allComments);
  const totalMessages = allComments.length;
  const uniqueAuthors = countUniqueAuthors(allComments);

  // Cache key from forum + comment content hash (same formula as before)
  const messageHash = createHash("md5")
    .update(JSON.stringify(comments.map((m) => ({ id: m.id, content: m.content }))))
    .digest("hex");
  const cacheKey = `analysis_${forumId}_${messageHash}`;

  if (!forceRegenerate) {
    try {
      const cachedDoc = await db.collection("analysisCache").doc(cacheKey).get();
      if (cachedDoc.exists) {
        log("info", "cache_hit", { forumId, status: 200, elapsedMs: elapsedMs() });
        return json(cachedDoc.data() as MessageAnalysisResponse);
      }
    } catch (cacheError) {
      log("warn", "cache_check_failed", { forumId, code: safeErrorCode(cacheError) });
    }
  }

  // Forum context from the trusted forum document
  const forumTitle = text(forum.title);
  const forumDescription = text(forum.description);
  const forumQuestion = text(forum.question);
  const category = Array.isArray(forum.tags) ? text(forum.tags[0]) : "";
  const forumContext = forumTitle
    ? `Forum: "${forumTitle}"${forumDescription ? `\nDescription: ${forumDescription}` : ''}${forumQuestion ? `\nQuestion: ${forumQuestion}` : ''}${category ? `\nCategory: ${category}` : ''}\n\n`
    : '';

  // Generate thread summaries first, then forum-level analysis
  const threadSummaries = buildThreadSummaries(comments);

  const analysisPrompt = `
${forumContext}Perform hierarchical analysis:
1. Analyze each thread's diction, tone, structure, and emotional intent
2. Synthesize into forum-level summary with Gen Z-friendly insights
3. Create actionable 3-step roadmap

Threads:
${threadSummaries.join('\n\n')}

Return JSON: {"summary": "...", "actionRoadmap": ["1️⃣ ...", "2️⃣ ...", "3️⃣ ..."]}`;

  log("info", "openai_request", {
    forumId,
    totalMessages,
    analyzedMessages: comments.length,
    threads: threadSummaries.length,
    forceRegenerate,
  });
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: analysisPrompt }],
    temperature: 0.3,
  });

  const aiResponse = completion.choices[0]?.message?.content || "";
  const analysis = parseModelAnalysis(aiResponse);
  log(analysis ? "info" : "warn", analysis ? "openai_parsed" : "openai_invalid_output", {
    forumId,
    responseLength: aiResponse.length,
    elapsedMs: elapsedMs(),
  });
  // Invalid output is never saved or replaced with made-up text; the client may retry
  if (!analysis) return json({ error: "Analysis unavailable", reason: "invalid_model_output" }, 502);

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

  const response: MessageAnalysisResponse = {
    totalMessages,
    uniqueAuthors,
    summary: analysis.summary,
    actionRoadmap: analysis.actionRoadmap,
  };
  log("info", "analysis_complete", { forumId, status: 200, totalMessages, uniqueAuthors, elapsedMs: elapsedMs() });
  return json(response);
}
