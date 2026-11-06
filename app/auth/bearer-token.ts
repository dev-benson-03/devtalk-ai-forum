/**
 * Extracts the token from an "Authorization: Bearer <token>" header.
 * Returns null for a missing, empty or malformed header.
 */
export function readBearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer[ ]+([^\s]+)\s*$/i);
  return match ? match[1] : null;
}
