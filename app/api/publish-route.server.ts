/**
 * Shared request handling for POST /api/forums and POST /api/comments:
 * authentication, body validation, moderation setup and the mapping from a
 * publish outcome to a safe HTTP response.
 *
 * Responses carry only codes (reason, field name). Logs carry only the
 * operation, safe IDs, statuses, codes and durations: never submitted text,
 * display names, tokens or moderation scores.
 */
import { requireUser, type AuthenticatedUser } from "../auth/authenticate.server";
import { getAdminDb } from "../firebase/admin.server";
import { createModerator, ModerationUnavailableError } from "../moderation/moderation.server";
import { openAIModerationProvider } from "../moderation/openai-provider.server";
import { PublishLimitStoreError } from "./publish-limits.server";
import { publishComment, publishForum, type PublishDeps, type PublishOutcome } from "./publish.server";
import { readJsonBody, validateCommentRequest, validateForumRequest, type Parsed } from "./publish-request";

type Operation = "forum" | "comment";

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  console[level]("[publish]", { event, ...fields });
}

/** gRPC codes Firestore uses for transient failures. */
const TRANSIENT_FIRESTORE_CODES = new Set([4, 8, 10, 14]);

function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "number") return `firestore/${code}`;
  return typeof code === "string" && /^[a-z]+\/[a-z0-9-]{1,64}$/.test(code) ? code : "unknown";
}

/** Whole seconds, at least 1, as Retry-After requires. */
const retryAfterSeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

function toResponse(outcome: PublishOutcome): Response {
  switch (outcome.kind) {
    // `support` only ever goes back to the author in this response
    case "published":
      return json(
        { id: outcome.id, duplicate: outcome.duplicate, ...(outcome.support ? { support: true } : {}) },
        outcome.duplicate ? 200 : 201
      );
    case "rejected":
      return json(
        { error: "Content not allowed", reason: outcome.reason, field: outcome.field, ...(outcome.support ? { support: true } : {}) },
        422
      );
    case "not_found":
      return json({ error: "Forum not found" }, 404);
    case "forbidden":
      return json({ error: "Forbidden" }, 403);
    case "closed":
      return json({ error: "Forum closed", reason: "forum_closed" }, 409);
    case "request_reused":
      return json({ error: "Invalid request", reason: "request_reused" }, 409);
    case "rate_limited": {
      const seconds = retryAfterSeconds(outcome.retryAfterMs);
      return json({ error: "Too many requests", reason: "rate_limited", retryAfterSeconds: seconds }, 429, {
        "Retry-After": String(seconds),
      });
    }
  }
}

const logFields = (outcome: PublishOutcome) =>
  outcome.kind === "published"
    ? { id: outcome.id, duplicate: outcome.duplicate }
    : outcome.kind === "rejected"
      ? { reason: outcome.reason, field: outcome.field }
      : outcome.kind === "rate_limited"
        ? { reason: "rate_limited", retryAfterSeconds: retryAfterSeconds(outcome.retryAfterMs) }
        : {};

export interface PublishRouteDeps {
  /** Defaults to the Admin SDK and the OpenAI moderation provider. */
  deps?: () => PublishDeps;
}

const defaultDeps = (): PublishDeps => ({ db: getAdminDb(), moderator: createModerator(openAIModerationProvider()) });

/** Handles one publish request end to end. */
export async function handlePublish(operation: Operation, request: Request, options: PublishRouteDeps = {}): Promise<Response> {
  const started = Date.now();
  const elapsedMs = () => Date.now() - started;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let user: AuthenticatedUser;
  try {
    user = await requireUser(request);
  } catch (thrown) {
    if (!(thrown instanceof Response)) throw thrown;
    log("warn", `${operation}.auth_failed`, { status: thrown.status });
    return thrown;
  }

  const body = await readJsonBody(request);
  const parsed: Parsed<unknown> = body.ok
    ? operation === "forum"
      ? validateForumRequest(body.value)
      : validateCommentRequest(body.value)
    : body;
  if (!parsed.ok) {
    log("warn", `${operation}.invalid_request`, { status: parsed.status, reason: parsed.reason, field: parsed.field });
    const error = parsed.status === 413 ? "Request too large" : "Invalid request";
    return json({ error, reason: parsed.reason, ...(parsed.field ? { field: parsed.field } : {}) }, parsed.status);
  }

  const forumId = operation === "comment" ? (parsed.value as { forumId: string }).forumId : undefined;
  try {
    const deps = (options.deps ?? defaultDeps)();
    const outcome =
      operation === "forum"
        ? await publishForum(deps, user, parsed.value as Parameters<typeof publishForum>[2])
        : await publishComment(deps, user, parsed.value as Parameters<typeof publishComment>[2]);
    const response = toResponse(outcome);
    log(outcome.kind === "published" ? "info" : "warn", `${operation}.${outcome.kind}`, {
      forumId,
      status: response.status,
      ...logFields(outcome),
      elapsedMs: elapsedMs(),
    });
    return response;
  } catch (error) {
    if (error instanceof ModerationUnavailableError) {
      // Fail closed: nothing was written
      log("error", `${operation}.moderation_unavailable`, { forumId, reason: error.reason, elapsedMs: elapsedMs() });
      return json({ error: "Publishing unavailable", reason: "moderation_unavailable" }, 503, { "Retry-After": "30" });
    }
    if (error instanceof PublishLimitStoreError) {
      // Fail closed, and never report a storage failure as "over the limit"
      log("error", `${operation}.rate_limit_unavailable`, { forumId, code: safeErrorCode(error.cause), elapsedMs: elapsedMs() });
      return json({ error: "Publishing unavailable", reason: "rate_limit_unavailable" }, 503, { "Retry-After": "30" });
    }
    const code = (error as { code?: unknown } | null)?.code;
    log("error", `${operation}.write_failed`, { forumId, code: safeErrorCode(error), elapsedMs: elapsedMs() });
    return typeof code === "number" && TRANSIENT_FIRESTORE_CODES.has(code)
      ? json({ error: "Service unavailable", reason: "storage_unavailable" }, 503, { "Retry-After": "5" })
      : json({ error: "Internal server error" }, 500);
  }
}
