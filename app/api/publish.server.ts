/**
 * Server-side publishing of forums and comments (Admin SDK). The only way
 * new forums and comments reach Firestore: firestore.rules deny browser
 * creates, so these checks are the whole gate. Order for each submission:
 *
 *   1. Duplicate check: was this requestId already used? Only the identical
 *      submission (same SHA-256 digest) counts as a duplicate.
 *   2. Forum state check (comments): exists, visible, open
 *   3. Moderation of every publishable text, outside any transaction
 *   4. One transaction that re-checks the duplicate and the forum state,
 *      then writes the document, the publish receipt and (comments) the
 *      forum's commentCount together.
 *
 * Identity comes only from the verified token. See
 * docs/architecture/publishing.md.
 */
import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { AuthenticatedUser } from "../auth/authenticate.server";
import { canViewForum } from "../auth/forum-access";
import { ANONYMOUS_NAME, TEXT_LIMITS } from "../forum/forum-options";
import type { ModerationField, Moderator } from "../moderation/moderation.server";
import type { PolicyReason } from "../moderation/policy.server";
import type { CommentRequest, ForumRequest } from "./publish-request";

type Firestore = ReturnType<typeof import("../firebase/admin.server").getAdminDb>;

/** Server-only: one receipt per published draft (uid + requestId). */
export const RECEIPT_COLLECTION = "publishRequests";
/** Receipts can be removed by a Firestore TTL policy on expiresAt after this. */
const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PublishOutcome =
  | { kind: "published"; id: string; duplicate: boolean }
  | { kind: "rejected"; reason: PolicyReason; field: string }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "closed" }
  | { kind: "request_reused" };

export interface PublishDeps {
  db: Firestore;
  moderator: Moderator;
  now?: () => Date;
}

/** The name shown with a post: from the verified token, or the anonymous name. */
export function displayNameFor(user: AuthenticatedUser, anonymous: boolean): string {
  if (anonymous) return ANONYMOUS_NAME;
  const token = user.token as { name?: unknown; email?: unknown };
  const name =
    (typeof token.name === "string" && token.name.trim()) ||
    (typeof token.email === "string" && token.email.trim()) ||
    "User";
  return name.slice(0, TEXT_LIMITS.displayName);
}

/** Hashed so any UID is a valid document ID. */
export const receiptId = (uid: string, requestId: string) =>
  createHash("sha256").update(`${uid}\u0000${requestId}`).digest("hex");

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * SHA-256 of the validated submission, bound to the operation and the
 * verified UID. Encoded as a JSON array in a fixed order, so the same
 * submission always gives the same digest. Every input that changes the
 * published record is included; the receipt stores only this digest,
 * never the text.
 */
export function forumDigest(uid: string, input: ForumRequest): string {
  return sha256([
    "devtalk-publish-v1", "forum", uid,
    input.title, input.description, input.question, input.category, input.timeLimitHours, input.anonymous,
  ]);
}

export function commentDigest(uid: string, input: CommentRequest): string {
  return sha256(["devtalk-publish-v1", "comment", uid, input.forumId, input.content, input.anonymous]);
}

/** Comments are accepted while the forum is active, not deleted and before endTime (legacy: no endTime = open). */
export function acceptsComments(forum: Record<string, unknown>, now: Date): boolean {
  if (forum.isAdminDeleted === true || forum.isActive === false) return false;
  if (!("endTime" in forum) || forum.endTime === undefined) return true;
  return forum.endTime instanceof Timestamp && forum.endTime.toMillis() > now.getTime();
}

type ReceiptCheck = { kind: "none" } | { kind: "same"; id: string } | { kind: "reused" };

/**
 * Same kind and same digest: the same submission, already published.
 * Anything else under this requestId (another operation, changed content,
 * a receipt without a digest) is a reused ID and never reported as success.
 */
function checkReceipt(data: Record<string, unknown> | undefined, kind: "forum" | "comment", digest: string): ReceiptCheck {
  if (!data) return { kind: "none" };
  return data.kind === kind && data.digest === digest && typeof data.targetId === "string"
    ? { kind: "same", id: data.targetId }
    : { kind: "reused" };
}

const fromReceipt = (check: ReceiptCheck): PublishOutcome | null =>
  check.kind === "same"
    ? { kind: "published", id: check.id, duplicate: true }
    : check.kind === "reused"
      ? { kind: "request_reused" }
      : null;

const receipt = (uid: string, kind: "forum" | "comment", digest: string, targetId: string, now: Date, forumId?: string) => ({
  uid,
  kind,
  digest,
  targetId,
  ...(forumId ? { forumId } : {}),
  createdAt: FieldValue.serverTimestamp(),
  expiresAt: Timestamp.fromMillis(now.getTime() + RECEIPT_TTL_MS),
});

/** Identity text that will be shown publicly is moderated too. */
const withName = (fields: ModerationField[], name: string, anonymous: boolean): ModerationField[] =>
  anonymous ? fields : [...fields, { name: "displayName", text: name }];

/**
 * Publishes a new forum. Throws ModerationUnavailableError when moderation
 * can't run (nothing is written) and Firestore errors as they come.
 */
export async function publishForum(deps: PublishDeps, user: AuthenticatedUser, input: ForumRequest): Promise<PublishOutcome> {
  const { db, moderator } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const receiptRef = db.collection(RECEIPT_COLLECTION).doc(receiptId(user.uid, input.requestId));
  const digest = forumDigest(user.uid, input);

  const earlier = fromReceipt(checkReceipt((await receiptRef.get()).data(), "forum", digest));
  if (earlier) return earlier;

  const creatorName = displayNameFor(user, input.anonymous);
  const decision = await moderator.moderate(
    withName(
      [
        { name: "title", text: input.title },
        { name: "description", text: input.description },
        { name: "question", text: input.question },
      ],
      creatorName,
      input.anonymous
    )
  );
  if (!decision.allowed) return { kind: "rejected", reason: decision.reason, field: decision.field };

  const forumRef = db.collection("forums").doc();
  const endTime = Timestamp.fromMillis(now.getTime() + Math.round(input.timeLimitHours * 3_600_000));
  return db.runTransaction(async (tx) => {
    const again = fromReceipt(checkReceipt((await tx.get(receiptRef)).data(), "forum", digest));
    if (again) return again;
    tx.create(forumRef, {
      title: input.title,
      description: input.description,
      question: input.question,
      creatorId: user.uid,
      creatorName,
      endTime,
      isActive: true,
      isAdminDeleted: false,
      tags: [input.category],
      messages: [""],
      summary: "",
      actionRoadmap: [""],
      commentCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      moderationPolicy: decision.policyVersion,
    });
    tx.create(receiptRef, receipt(user.uid, "forum", digest, forumRef.id, now));
    return { kind: "published", id: forumRef.id, duplicate: false };
  });
}

/** Forum checks shared by the pre-check and the final transaction. */
function forumGate(user: AuthenticatedUser, forum: Record<string, unknown> | undefined, now: Date): PublishOutcome | null {
  if (!forum) return { kind: "not_found" };
  if (!canViewForum(user, forum)) return { kind: "forbidden" };
  if (!acceptsComments(forum, now)) return { kind: "closed" };
  return null;
}

const countOf = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : 0);

/**
 * Publishes a new comment and increments the forum's commentCount in the
 * same transaction. Moderation runs before the transaction; the forum's
 * state is checked again inside it, so a forum closed or deleted while
 * moderation ran gets no new comment.
 */
export async function publishComment(deps: PublishDeps, user: AuthenticatedUser, input: CommentRequest): Promise<PublishOutcome> {
  const { db, moderator } = deps;
  const clock = deps.now ?? (() => new Date());
  const receiptRef = db.collection(RECEIPT_COLLECTION).doc(receiptId(user.uid, input.requestId));
  const forumRef = db.collection("forums").doc(input.forumId);
  const digest = commentDigest(user.uid, input);

  const earlier = fromReceipt(checkReceipt((await receiptRef.get()).data(), "comment", digest));
  if (earlier) return earlier;
  const blocked = forumGate(user, (await forumRef.get()).data(), clock());
  if (blocked) return blocked;

  const userName = displayNameFor(user, input.anonymous);
  const decision = await moderator.moderate(withName([{ name: "content", text: input.content }], userName, input.anonymous));
  if (!decision.allowed) return { kind: "rejected", reason: decision.reason, field: decision.field };

  return db.runTransaction(async (tx) => {
    const receiptSnap = await tx.get(receiptRef);
    const forumSnap = await tx.get(forumRef);
    const again = fromReceipt(checkReceipt(receiptSnap.data(), "comment", digest));
    if (again) return again;
    const now = clock();
    const stillBlocked = forumGate(user, forumSnap.data(), now);
    if (stillBlocked) return stillBlocked;

    const commentRef = db.collection("comments").doc();
    tx.create(commentRef, {
      forumId: input.forumId,
      userId: user.uid,
      userName,
      content: input.content,
      createdAt: FieldValue.serverTimestamp(),
      upvotes: 0,
      downvotes: 0,
      moderationPolicy: decision.policyVersion,
    });
    tx.update(forumRef, { commentCount: countOf(forumSnap.data()?.commentCount) + 1 });
    tx.create(receiptRef, receipt(user.uid, "comment", digest, commentRef.id, now, input.forumId));
    return { kind: "published", id: commentRef.id, duplicate: false };
  });
}
