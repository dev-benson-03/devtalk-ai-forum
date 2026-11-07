/**
 * Browser side of publishing: sends a forum or comment to the server
 * (POST /api/forums, POST /api/comments) with the user's Firebase ID token.
 * The server moderates and writes it; browsers can no longer create forums
 * or comments in Firestore directly.
 *
 * Errors carry only codes. Messages for people are in publishErrorMessage.
 */
import type { User } from "firebase/auth";
import { firebaseAuth } from "../firebase/config";

export interface ForumSubmission {
  title: string;
  description: string;
  question: string;
  category: string;
  timeLimitHours: number;
  anonymous: boolean;
  /** One per draft (crypto.randomUUID()): a retried draft is published once. */
  requestId: string;
}

export interface CommentSubmission {
  forumId: string;
  content: string;
  anonymous: boolean;
  requestId: string;
}

export type PublishErrorKind =
  | "rejected" // moderation: revise and resubmit
  | "unavailable" // moderation or storage down: retry later
  | "rate_limited" // the user's publishing allowance is used up: wait, then resend
  | "closed"
  | "signed_out"
  | "failed";

/** What a successful publish returns. */
export interface PublishResult {
  id: string;
  /** Show the author SUPPORT_MESSAGE (see content-policy.md). */
  support?: boolean;
}

/**
 * Shown only to the author, in their own browser, when moderation reads a
 * post as a personal self-harm disclosure (or rejects self-harm content).
 * It promises nothing: no monitoring, review or intervention.
 */
export const SUPPORT_MESSAGE =
  "If you're going through something difficult, support is available. Consider reaching out to someone you trust " +
  "or a qualified mental health professional. If you're in immediate danger, contact local emergency services or a " +
  "crisis support service. In the U.S., you can call or text 988 (Suicide & Crisis Lifeline). Elsewhere, " +
  "findahelpline.com lists services in many countries.";

export class PublishError extends Error {
  constructor(
    readonly kind: PublishErrorKind,
    readonly status?: number,
    readonly reason?: string,
    readonly field?: string,
    /** Show SUPPORT_MESSAGE with the rejection. */
    readonly support = false,
    /** rate_limited: how long the server asked to wait, when it said. */
    readonly retryAfterSeconds?: number
  ) {
    super(`Publish failed: ${kind}`);
    this.name = "PublishError";
  }
}

async function currentUser(): Promise<User | null> {
  await firebaseAuth.authStateReady();
  return firebaseAuth.currentUser;
}

/**
 * True when the server says this draft's requestId already published a
 * different submission. The page then starts a new ID for the next send.
 */
export const isRequestReused = (error: unknown): boolean =>
  error instanceof PublishError && error.reason === "request_reused";

/** New ID for a draft. */
export const newRequestId = (): string => crypto.randomUUID();

/** The anonymous preference from the dashboard toggle; anonymous unless turned off. */
export const prefersAnonymous = (): boolean =>
  typeof window === "undefined" || window.sessionStorage.getItem("anonymous") !== "false";

/** A whole number of seconds up to one day, or undefined. */
const waitSeconds = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 86_400 ? (value as number) : undefined;

const textField = (value: unknown) => (typeof value === "string" && /^[a-zA-Z_]{1,32}$/.test(value) ? value : undefined);

async function send(path: string, body: unknown, getUser: () => Promise<User | null>): Promise<PublishResult> {
  const user = await getUser();
  if (!user) throw new PublishError("signed_out");
  const request = async (forceRefresh: boolean) => {
    let token: string;
    try {
      token = await user.getIdToken(forceRefresh);
    } catch {
      throw new PublishError("signed_out");
    }
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  };

  let response: Response;
  try {
    response = await request(false);
    if (response.status === 401) response = await request(true);
  } catch (error) {
    if (error instanceof PublishError) throw error;
    throw new PublishError("unavailable"); // network error: nothing was confirmed
  }
  if (response.ok) {
    const result = (await response.json()) as { id: string; support?: unknown };
    return { id: result.id, ...(result.support === true ? { support: true } : {}) };
  }

  const details = (await response.json().catch(() => ({}))) as {
    reason?: unknown;
    field?: unknown;
    support?: unknown;
    retryAfterSeconds?: unknown;
  };
  const reason = textField(details.reason);
  const field = textField(details.field);
  const status = response.status;
  if (status === 401) throw new PublishError("signed_out", status);
  if (status === 422) throw new PublishError("rejected", status, reason, field, details.support === true);
  if (status === 409 && reason === "forum_closed") throw new PublishError("closed", status, reason);
  if (status === 429) {
    throw new PublishError("rate_limited", status, reason, undefined, false, waitSeconds(details.retryAfterSeconds));
  }
  if (status === 503) throw new PublishError("unavailable", status, reason);
  throw new PublishError("failed", status, reason, field);
}

export const publishForum = (forum: ForumSubmission, getUser = currentUser) => send("/api/forums", forum, getUser);

export const publishComment = (comment: CommentSubmission, getUser = currentUser) =>
  send("/api/comments", comment, getUser);

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  question: "main question",
  content: "message",
  displayName: "display name",
};

const REASON_LABELS: Record<string, string> = {
  sexual: "sexual content",
  self_harm: "content that could encourage self-harm",
  profanity: "strong profanity",
  hate_harassment: "hate or harassment",
  threat: "threatening language",
  graphic_violence: "graphic violence",
  unsafe: "unsafe content",
};

/** "about 5 minutes": rounded up, in the largest whole unit. */
function roughWait(seconds: number): string {
  const [amount, unit] =
    seconds < 60 ? [seconds, "second"] : seconds < 3600 ? [Math.ceil(seconds / 60), "minute"] : [Math.ceil(seconds / 3600), "hour"];
  return `about ${amount} ${unit}${amount === 1 ? "" : "s"}`;
}

/** A short, respectful message for an alert. Never includes server details. */
export function publishErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof PublishError)) return fallback;
  switch (error.kind) {
    case "rejected": {
      const field = FIELD_LABELS[error.field ?? ""] ?? "post";
      const reason = REASON_LABELS[error.reason ?? ""];
      const fix =
        error.field === "displayName"
          ? "Please post anonymously or change your display name."
          : "Please revise it and try again.";
      const message = `Your ${field} doesn't meet DevTalk's community guidelines${reason ? ` (${reason})` : ""}. ${fix}`;
      return error.support ? `${message}\n\n${SUPPORT_MESSAGE}` : message;
    }
    case "unavailable":
      return "Publishing is temporarily unavailable. Your draft is still here, so you can try again in a moment.";
    case "rate_limited": {
      const when = error.retryAfterSeconds ? `in ${roughWait(error.retryAfterSeconds)}` : "later";
      return `You're posting faster than DevTalk allows. Your draft is still here, so please try again ${when}.`;
    }
    case "closed":
      return "This forum has closed and no longer accepts new messages.";
    case "signed_out":
      return "Please sign in again to post.";
    default:
      return fallback;
  }
}
