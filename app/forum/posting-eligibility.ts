/**
 * Whether the forum page should offer posting: the browser's copy of the
 * server's comment rule (acceptsComments in app/api/publish.server.ts).
 *
 * This is about posting only. Who may VIEW a forum is decided elsewhere
 * (canViewForum, firestore.rules); a creator or admin can view a hidden or
 * deleted forum that still takes no new messages. The comparisons are exact,
 * as on the server: only isAdminDeleted === true and isActive === false
 * close a forum. A missing or oddly typed flag does not independently
 * block posting; expiry still applies (forumWindow). This is not the same
 * as being listed: the list query requires stored isActive == true and
 * isAdminDeleted == false.
 *
 * A user-experience aid only: the server decides. Browser-safe; no server
 * imports. A parity test runs both rules over the same synthetic forums.
 */
import { forumWindow } from "./stored-time";

export type PostingBlock = "deleted" | "hidden" | "ended" | "end_time_unreadable";

export type PostingEligibility =
  | { accepting: true; end: Date | null }
  | { accepting: false; end: Date | null; reason: PostingBlock };

export function postingEligibility(
  forum: { isActive?: unknown; isAdminDeleted?: unknown; endTime?: unknown },
  now: Date
): PostingEligibility {
  if (forum.isAdminDeleted === true) return { accepting: false, end: null, reason: "deleted" };
  if (forum.isActive === false) return { accepting: false, end: null, reason: "hidden" };
  const window = forumWindow(forum.endTime, now);
  if (window.accepting) return { accepting: true, end: window.end };
  return { accepting: false, end: window.end, reason: window.end ? "ended" : "end_time_unreadable" };
}

/** Safe wording for a blocked send; no internal state is named. */
export function postingUnavailableMessage(reason: PostingBlock): string {
  return reason === "ended"
    ? "This forum has closed and no longer accepts new messages."
    : "This forum isn't accepting new messages.";
}
