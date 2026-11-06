/**
 * Authentication only: who is calling. Authorization (may they do this?)
 * lives in authorize.ts so each route decides it explicitly.
 */
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth } from "../firebase/admin.server";
import { readBearerToken } from "./bearer-token";
import { jsonError } from "./responses";

export interface AuthenticatedUser {
  /** UID from the verified token. Never take a UID from the request body. */
  uid: string;
  token: DecodedIdToken;
}

export function unauthorized(): Response {
  return jsonError(401, "Unauthorized", { "WWW-Authenticate": 'Bearer realm="devtalk"' });
}

const isAuthError = (error: unknown) =>
  String((error as { code?: unknown })?.code ?? "").startsWith("auth/");

/**
 * Verifies the request's Firebase ID token (signature, expiry, revocation,
 * disabled user). Throws a 401 Response if it is missing or rejected.
 * Other failures, such as bad server credentials, are rethrown (500).
 */
export async function requireUser(
  request: Request,
  auth: Pick<Auth, "verifyIdToken"> = getAdminAuth()
): Promise<AuthenticatedUser> {
  const idToken = readBearerToken(request.headers.get("Authorization"));
  if (!idToken) throw unauthorized();

  try {
    const token = await auth.verifyIdToken(idToken, true);
    return { uid: token.uid, token };
  } catch (error) {
    if (!isAuthError(error)) throw error;
    // Log the error code only: never the token or the SDK message
    console.warn("[auth] ID token rejected:", (error as { code: string }).code);
    throw unauthorized();
  }
}
