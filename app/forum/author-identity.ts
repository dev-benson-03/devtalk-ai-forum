/**
 * Who a new forum or comment is attributed to. The stored ID is always the
 * signed-in user's Firebase UID (Firestore rules reject anything else); the
 * "anonymous" display preference only changes the name shown to others.
 */
export interface AuthorUser {
  uid: string;
  displayName?: string | null;
  email?: string | null;
}

export const ANONYMOUS_NAME = "Anonymous User";

export function authorIdentity(user: AuthorUser | null, anonymousPreference: string | null) {
  const id = user?.uid || "anonymous"; // signed out: rejected by the rules
  const name =
    anonymousPreference === "false" && user ? user.displayName || user.email || "User" : ANONYMOUS_NAME;
  return { id, name };
}
