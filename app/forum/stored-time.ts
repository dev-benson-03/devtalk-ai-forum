/**
 * Reading stored forum and comment dates in the browser. Legacy documents can
 * hold strings, numbers, nulls or malformed objects where a Firestore
 * Timestamp is expected, so every reader here returns null rather than
 * throwing, and nothing is guessed.
 *
 * Accepted:
 *   - a Firestore Timestamp, or any value whose toDate() returns a valid Date;
 *   - an ISO 8601 instant with an explicit zone, YYYY-MM-DDTHH:mm[:ss[.fff]]
 *     followed by Z or ±HH:MM, with every part range-checked (no Feb 30, no
 *     hour 24, offset at most 14:00). This is the same contract as the
 *     legacy-data audit's parseEndTimeString (scripts/legacy-audit/audit.ts),
 *     and a test checks the two agree.
 * Rejected: date-only and zone-less strings (which time zone?), other
 * formats, numbers (seconds or milliseconds?), and every other type.
 *
 * Browser-safe: no Firebase imports and no server modules.
 */

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseZonedIso(value: string): Date | null {
  const m = ISO_INSTANT.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map((i) => Number(m[i]));
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millis = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
  const [offH, offM] = m[8] === "Z" ? [0, 0] : [Number(m[10]), Number(m[11])];
  if (offH > 14 || offM > 59 || (offH === 14 && offM > 0)) return null;

  // setUTCFullYear keeps years below 100 as written (0099 is not 1999)
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millis);
  const rolledOver =
    local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day ||
    local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second;
  if (rolledOver) return null;

  const date = new Date(local.getTime() - (m[9] === "-" ? -1 : 1) * (offH * 60 + offM) * 60_000);
  const y = date.getUTCFullYear();
  return Number.isFinite(date.getTime()) && y >= 1 && y <= 9999 ? date : null;
}

/** A Timestamp-like value: toDate() is a function that returns a valid Date. */
function readTimestampLike(value: object): Date | null {
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return null;
  try {
    const date: unknown = toDate.call(value);
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

/** The stored value as a Date when its meaning is established, otherwise null. Never throws. */
export function readStoredDate(value: unknown): Date | null {
  if (typeof value === "string") return parseZonedIso(value);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return readTimestampLike(value);
  return null;
}

export const UNKNOWN_DATE = "Unknown date";

/** Formats as the views always have (locale date, or date and time), or "Unknown date". */
export function storedDateText(value: unknown, style: "date" | "dateTime"): string {
  const date = readStoredDate(value);
  if (!date) return UNKNOWN_DATE;
  return style === "date" ? date.toLocaleDateString() : date.toLocaleString();
}

/**
 * Whether a forum takes new messages, by the server's rule
 * (acceptsComments in app/api/publish.server.ts): no endTime means open;
 * a Timestamp means open until that instant; anything else stored there,
 * including null and a valid ISO string, means closed. `end` is set only for
 * a Timestamp, so the views never suggest a string end time is in force.
 * Visibility flags are handled by the server and the forum queries, not here.
 */
export type ForumWindow = { accepting: boolean; end: Date | null };

export function forumWindow(endTime: unknown, now: Date): ForumWindow {
  if (endTime === undefined) return { accepting: true, end: null };
  const end = typeof endTime === "object" && endTime !== null && !Array.isArray(endTime) ? readTimestampLike(endTime) : null;
  if (!end) return { accepting: false, end: null };
  return { accepting: end.getTime() > now.getTime(), end };
}

/**
 * Ascending by date, with unreadable values first (where the old code's
 * epoch-0 fallback put them). Returns 0 between two unreadable values, so
 * callers add their own tie-breaker. Never NaN.
 */
export function compareStoredDates(a: unknown, b: unknown): number {
  const x = readStoredDate(a)?.getTime();
  const y = readStoredDate(b)?.getTime();
  if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Code-point order of document IDs: a stable, locale-independent tie-breaker. */
export const byDocumentId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
