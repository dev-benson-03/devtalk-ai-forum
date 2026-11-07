/**
 * A safe error category for browser logs: a Firebase-style code such as
 * "auth/wrong-password" or "permission-denied", or "unknown". Never the
 * error's message or attached data, which can include emails or content.
 */
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z-]+(\/[a-z0-9-]{1,64})?$/.test(code) ? code : "unknown";
}
