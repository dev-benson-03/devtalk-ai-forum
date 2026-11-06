/**
 * Browser Firestore operations whose shape firestore.rules depends on. They
 * take the Firestore instance as a parameter so the rules tests run the same
 * code against the emulator.
 */
import { collection, doc, query, runTransaction, serverTimestamp, where, type Firestore } from "firebase/firestore";

/**
 * Forums shown on the list page. Rules are not filters: a query is allowed
 * only if every possible result is readable, so the restriction to active,
 * not admin-deleted forums has to be in the query itself. Equality filters
 * only, so no composite index is needed; the page sorts by endTime itself.
 */
export const listedForumsQuery = (db: Firestore) =>
  query(collection(db, "forums"), where("isActive", "==", true), where("isAdminDeleted", "==", false));

export interface NewComment {
  forumId: string;
  userId: string;
  userName: string;
  content: string;
}

/**
 * New comments get a predictable ID, `<forumId>_<n>`, where n is the forum's
 * new commentCount. That lets the rules check that each +1 to commentCount
 * comes with exactly one new comment written in the same transaction.
 */
export const commentIdFor = (forumId: string, count: number) => `${forumId}_${count}`;

const currentCount = (value: unknown) => (Number.isInteger(value) ? (value as number) : 0);

/** Creates the comment and increments the forum's commentCount atomically. Returns the comment ID. */
export function createCommentRecord(db: Firestore, comment: NewComment): Promise<string> {
  const forumRef = doc(db, "forums", comment.forumId);
  return runTransaction(db, async (tx) => {
    const forum = await tx.get(forumRef);
    if (!forum.exists()) throw new Error("Forum not found");
    const next = currentCount(forum.data().commentCount) + 1;
    const commentRef = doc(db, "comments", commentIdFor(comment.forumId, next));
    tx.set(commentRef, {
      forumId: comment.forumId,
      userId: comment.userId,
      userName: comment.userName,
      content: comment.content,
      createdAt: serverTimestamp(),
      upvotes: 0,
      downvotes: 0,
    });
    tx.update(forumRef, { commentCount: next });
    return commentRef.id;
  });
}
