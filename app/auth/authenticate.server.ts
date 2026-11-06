/**
 * Authentication only: who is calling. Authorization (may they do this?)
 * lives in authorize.ts so each route decides it explicitly.
 */
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth } from "../firebase/admin.server";
import { readBearerToken } from "./bearer-token";
import { classifyAuthError, type AuthFailure } from "./classify-auth-error";
import { jsonError } from "./responses";

export interface AuthenticatedUser {
  /** UID from the verified token. Never take a UID from the request body. */
  uid: string;
  token: DecodedIdToken;
}

export function unauthorized(): Response {
  return jsonError(401, "Unauthorized", { "WWW-Authenticate": 'Bearer realm="devtalk"' });
}

function failureResponse({ status }: AuthFailure): Response {
  if (status === 401) return unauthorized();
  if (status === 503) return jsonError(503, "Service unavailable", { "Retry-After": "5" });
  return jsonError(500, "Internal server error");
}

/** Structured, sanitized log: status, category and a known-safe code only. */
function logFailure(failure: AuthFailure): void {
  const entry = { event: "auth.verify_failed", ...failure };
  if (failure.status === 401) console.warn("[auth]", entry);
  else console.error("[auth]", entry);
}

/**
 * Verifies the request's Firebase ID token (signature, expiry, revocation,
 * disabled user) and throws a sanitized Response on failure: 401 for a bad
 * token, 503 when Firebase is unavailable, 500 for server-side problems.
 */
export async function requireUser(
  request: Request,
  auth?: Pick<Auth, "verifyIdToken">
): Promise<AuthenticatedUser> {
  const idToken = readBearerToken(request.headers.get("Authorization"));
  if (!idToken) throw unauthorized();

  try {
    const token = await (auth ?? getAdminAuth()).verifyIdToken(idToken, true);
    return { uid: token.uid, token };
  } catch (error) {
    const failure = classifyAuthError(error);
    logFailure(failure);
    throw failureResponse(failure);
  }
}
