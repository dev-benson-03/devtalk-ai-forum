/**
 * Maps a failure from verifyIdToken to an HTTP status, using only the
 * documented firebase-admin error codes (never error messages).
 */
export type AuthFailureCategory = "invalid_token" | "service_unavailable" | "server_config" | "unexpected";

export interface AuthFailure {
  status: 401 | 500 | 503;
  category: AuthFailureCategory;
  /** A known-safe code such as "auth/id-token-expired", or "unknown". */
  code: string;
}

// The caller's token is bad, expired, revoked, or its user is gone or disabled
const INVALID_TOKEN = new Set([
  "auth/argument-error",
  "auth/invalid-id-token",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/user-disabled",
  "auth/user-not-found",
]);

// Google's Auth backend is down, throttling, or unreachable
const SERVICE_UNAVAILABLE = new Set([
  "auth/internal-error",
  "auth/quota-exceeded",
  "app/network-error",
  "app/network-timeout",
]);

// Our own credentials or project are wrong
const SERVER_CONFIG = new Set([
  "admin/invalid-config",
  "auth/invalid-credential",
  "app/invalid-credential",
  "auth/insufficient-permission",
  "auth/project-not-found",
]);

const SAFE_CODE = /^(auth|app|admin)\/[a-z0-9-]{1,64}$/;

export function classifyAuthError(error: unknown): AuthFailure {
  const raw = (error as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" && SAFE_CODE.test(raw) ? raw : "unknown";
  if (INVALID_TOKEN.has(code)) return { status: 401, category: "invalid_token", code };
  if (SERVICE_UNAVAILABLE.has(code)) return { status: 503, category: "service_unavailable", code };
  if (SERVER_CONFIG.has(code)) return { status: 500, category: "server_config", code };
  return { status: 500, category: "unexpected", code };
}
