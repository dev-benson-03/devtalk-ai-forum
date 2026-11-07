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
  | "closed"
  | "signed_out"
  | "failed";

export class PublishError extends Error {
  constructor(
    readonly kind: PublishErrorKind,
    readonly status?: number,
    readonly reason?: string,
    readonly field?: string
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

const textField = (value: unknown) => (typeof value === "string" && /^[a-zA-Z_]{1,32}$/.test(value) ? value : undefined);

async function send(path: string, body: unknown, getUser: () => Promise<User | null>): Promise<{ id: string }> {
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
  if (response.ok) return (await response.json()) as { id: string };

  const details = (await response.json().catch(() => ({}))) as { reason?: unknown; field?: unknown };
  const reason = textField(details.reason);
  const field = textField(details.field);
  const status = response.status;
  if (status === 401) throw new PublishError("signed_out", status);
  if (status === 422) throw new PublishError("rejected", status, reason, field);
  if (status === 409 && reason === "forum_closed") throw new PublishError("closed", status, reason);
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
  profanity: "strong profanity",
  hate_harassment: "hate or harassment",
  threat: "threatening language",
  graphic_violence: "graphic violence",
  unsafe: "unsafe content",
};

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
      return `Your ${field} doesn't meet DevTalk's community guidelines${reason ? ` (${reason})` : ""}. ${fix}`;
    }
    case "unavailable":
      return "Publishing is temporarily unavailable. Your draft is still here, so you can try again in a moment.";
    case "closed":
      return "This forum has closed and no longer accepts new messages.";
    case "signed_out":
      return "Please sign in again to post.";
    default:
      return fallback;
  }
}
