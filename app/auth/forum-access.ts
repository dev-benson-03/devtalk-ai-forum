/**
 * Forum authorization from trusted (server-read) forum fields. Field names are
 * the ones the app writes: `creatorId`, `isActive`, `isAdminDeleted`
 * (app/forum/create-forum.tsx, app/hooks/useFirestore.ts).
 *
 * Admins: the only admin check in the app today is a hardcoded UID compared
 * in the browser (account/login.tsx), which the server must not trust. The
 * server recognises admins only by an `admin: true` custom claim on the
 * verified ID token. No account has that claim yet, so admin rights are
 * effectively off (fail closed) until one is set with the Admin SDK.
 */
import type { AuthenticatedUser } from "./authenticate.server";

export interface ForumAccessFields {
  creatorId?: unknown;
  isActive?: unknown;
  isAdminDeleted?: unknown;
}

export const isAdmin = (user: AuthenticatedUser): boolean =>
  (user.token as { admin?: unknown }).admin === true;

/** True only for a real UID match; "anonymous" creators own nothing. */
export const isCreator = (user: AuthenticatedUser, forum: ForumAccessFields): boolean =>
  typeof forum.creatorId === "string" &&
  forum.creatorId !== "" &&
  forum.creatorId !== "anonymous" &&
  forum.creatorId === user.uid;

/**
 * Admin-deleted forums: admins only. Inactive forums (hidden from the forum
 * list): creator or admin. Everything else: any signed-in user, matching
 * what the forum page shows today. Closed forums (past endTime) stay viewable.
 */
export function canViewForum(user: AuthenticatedUser, forum: ForumAccessFields): boolean {
  if (forum.isAdminDeleted === true) return isAdmin(user);
  if (forum.isActive === false) return isCreator(user, forum) || isAdmin(user);
  return true;
}

/** Forcing a fresh analysis (skipping the cache) is limited to creator or admin. */
export const canForceRegenerate = (user: AuthenticatedUser, forum: ForumAccessFields): boolean =>
  isCreator(user, forum) || isAdmin(user);
