/**
 * Browser-side admin indicator. The only admin signal is the `admin: true`
 * custom claim on the user's verified Firebase ID token, the same one the
 * server (app/auth/forum-access.ts) and firestore.rules check. Never a UID
 * list, sessionStorage or anything else the browser can set. This only
 * decides what the UI shows; the server and the rules enforce access.
 */
import { getIdTokenResult, type User } from "firebase/auth";

export async function hasAdminClaim(user: User | null, forceRefresh = false): Promise<boolean> {
  if (!user) return false;
  try {
    const { claims } = await getIdTokenResult(user, forceRefresh);
    return claims.admin === true;
  } catch {
    // Missing, expired or revoked token: not an admin
    return false;
  }
}

/** Removes the old sessionStorage role flags, which nothing may trust. */
export function clearLegacyRoleFlags(storage: Pick<Storage, "removeItem">) {
  storage.removeItem("role");
  storage.removeItem("admin");
}
