/**
 * Authorization checks, kept apart from authentication. Each takes the
 * verified user and throws a 403 Response when access is not allowed.
 */
import type { AuthenticatedUser } from "./authenticate.server";
import { jsonError } from "./responses";

export function forbidden(): Response {
  return jsonError(403, "Forbidden");
}

/** Allows the call only when the verified user owns the resource. */
export function requireOwner(user: AuthenticatedUser, ownerUid: unknown): void {
  if (typeof ownerUid !== "string" || ownerUid === "" || ownerUid !== user.uid) {
    throw forbidden();
  }
}
