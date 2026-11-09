/**
 * Legacy-data audit: pure logic, no Firestore, no I/O, no writes.
 * (docs/architecture/legacy-data.md)
 *
 * Input: forums and comments reduced to the audited fields only (adapters in
 * sources.ts never pass text or names). Output: a deterministic report of
 * findings, proposed field corrections where the intended value follows from
 * existing code, and items needing a manual decision. Nothing is applied:
 * this module has no way to write.
 *
 * Kept to erasable TypeScript so Node can run it directly (cli.mjs).
 */

/** Versions of MODERATION_POLICY_VERSION that have existed in app/moderation/policy.server.ts. */
export const RECOGNIZED_MODERATION_POLICIES = ["sfw-2026-11-06", "sfw-2026-11-07"] as const;

export type DocFields = Record<string, unknown>;
export interface DocInput {
  id: string;
  fields: DocFields;
}
export interface AuditInput {
  forums: DocInput[];
  comments: DocInput[];
}

/** Report order. Categories overlap: one document can be in several. */
export const CATEGORIES = [
  "forum_is_active_missing",
  "forum_is_admin_deleted_missing",
  "forum_visibility_invalid_type",
  "forum_end_time_missing",
  "forum_end_time_string_convertible",
  "forum_end_time_invalid",
  "forum_comment_count_missing",
  "forum_comment_count_invalid",
  "forum_comment_count_mismatch",
  "forum_moderation_unknown",
  "forum_moderation_unrecognized",
  "comment_forum_id_invalid",
  "comment_orphaned",
  "comment_moderation_unknown",
  "comment_moderation_unrecognized",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** What a future apply must still find before it may write (never text). */
export type Expectation = { missing: true } | { type: string; value?: ExpectedValue };
/**
 * JSON can't carry NaN, Infinity, -Infinity or -0 (stringify turns the first
 * three into null and -0 into 0), so those are written as tagged values that
 * survive a JSON round trip unchanged.
 */
export type NonFiniteTag = "NaN" | "Infinity" | "-Infinity" | "-0";
export type ExpectedValue = boolean | number | string | { $number: NonFiniteTag };
export type PatchValue = boolean | number | { $timestamp: string };

export interface ProposedCorrection {
  path: string;
  set: Record<string, PatchValue>;
  expect: Record<string, Expectation>;
  reasons: Category[];
}

export interface ManualReviewItem {
  path: string;
  category: Category;
  field: string;
  /** A code, never the stored value. */
  detail: string;
}

export interface AuditReport {
  tool: "legacy-data-audit";
  reportVersion: 1;
  mode: "read-only";
  writesPerformed: 0;
  recognizedModerationPolicies: readonly string[];
  inspected: { forums: number; comments: number };
  findingCounts: Record<Category, number>;
  findings: Record<Category, string[]>;
  affectedDocuments: { forums: number; comments: number; total: number };
  proposedCorrections: ProposedCorrection[];
  manualReview: ManualReviewItem[];
  notes: string[];
}

// ---- Value types ---------------------------------------------------------

/** A Firestore Timestamp (Admin SDK) or a test stand-in. JSON can't produce one. */
const isTimestamp = (value: unknown): value is { toMillis(): number } =>
  typeof value === "object" && value !== null && typeof (value as { toMillis?: unknown }).toMillis === "function";

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isTimestamp(value)) return "timestamp";
  if (typeof value === "object") return "map";
  return typeof value;
}

/** Numbers JSON can't represent exactly become { $number: tag }. */
function encodeNumber(value: number): number | { $number: NonFiniteTag } {
  if (Number.isNaN(value)) return { $number: "NaN" };
  if (value === Infinity) return { $number: "Infinity" };
  if (value === -Infinity) return { $number: "-Infinity" };
  if (Object.is(value, -0)) return { $number: "-0" };
  return value;
}

/** Only scalar values that can't carry submitted text are echoed back. */
function expectationOf(value: unknown): Expectation {
  if (value === undefined) return { missing: true };
  if (typeof value === "number") return { type: "number", value: encodeNumber(value) };
  if (typeof value === "boolean") return { type: "boolean", value };
  return { type: typeOf(value) };
}

// ---- endTime parsing contract ---------------------------------------------

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;
const ISO_NO_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type EndTimeParse = { ok: true; iso: string } | { ok: false; reason: "date_only" | "no_time_zone" | "unrecognized_format" | "out_of_range" };

/**
 * Accepts only an ISO 8601 instant with an explicit zone:
 * YYYY-MM-DDTHH:mm[:ss[.fff]] followed by Z or ±HH:MM. Every component is
 * range-checked (no Feb 30, no hour 24, no leap second, offset ≤ 14:00);
 * nothing is rolled over or guessed. Date-only and zone-less strings are
 * ambiguous (which day or time zone?), and other formats such as 01/02/2026
 * are rejected. Years are four digits and built with setUTCFullYear, so
 * 0099 stays 99 AD instead of becoming 1999.
 */
export function parseEndTimeString(value: string): EndTimeParse {
  const m = ISO_INSTANT.exec(value);
  if (!m) {
    if (ISO_DATE_ONLY.test(value)) return { ok: false, reason: "date_only" };
    if (ISO_NO_ZONE.test(value)) return { ok: false, reason: "no_time_zone" };
    return { ok: false, reason: "unrecognized_format" };
  }
  const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map((i) => Number(m[i]));
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millis = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
  const offsetSign = m[9] === "-" ? -1 : 1;
  const [offH, offM] = m[8] === "Z" ? [0, 0] : [Number(m[10]), Number(m[11])];

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millis);
  const sameFields =
    local.getUTCFullYear() === year && local.getUTCMonth() === month - 1 && local.getUTCDate() === day &&
    local.getUTCHours() === hour && local.getUTCMinutes() === minute && local.getUTCSeconds() === second;
  if (!sameFields || offH > 14 || offM > 59 || (offH === 14 && offM > 0)) return { ok: false, reason: "out_of_range" };

  const instant = local.getTime() - offsetSign * (offH * 60 + offM) * 60_000;
  const date = new Date(instant);
  // Firestore Timestamps cover 0001-01-01 to 9999-12-31
  if (!Number.isFinite(instant) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    return { ok: false, reason: "out_of_range" };
  }
  return { ok: true, iso: date.toISOString() };
}

// ---- Audit -----------------------------------------------------------------

/** Code-point order, independent of locale. */
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const isValidCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

const isRecognizedPolicy = (value: unknown) =>
  typeof value === "string" && (RECOGNIZED_MODERATION_POLICIES as readonly string[]).includes(value);

export function auditLegacyData(input: AuditInput): AuditReport {
  const forums = [...input.forums].sort(byId);
  const comments = [...input.comments].sort(byId);
  const forumIds = new Set(forums.map((f) => f.id));

  const findings = Object.fromEntries(CATEGORIES.map((c) => [c, [] as string[]])) as Record<Category, string[]>;
  const manualReview: ManualReviewItem[] = [];
  const corrections: ProposedCorrection[] = [];
  const counted = new Map<string, number>();

  const flag = (category: Category, path: string) => {
    if (!findings[category].includes(path)) findings[category].push(path);
  };
  const manual = (path: string, category: Category, field: string, detail: string) => {
    flag(category, path);
    manualReview.push({ path, category, field, detail });
  };
  const moderation = (path: string, value: unknown, unknown: Category, unrecognized: Category) => {
    if (value === undefined) flag(unknown, path);
    else if (!isRecognizedPolicy(value)) flag(unrecognized, path);
  };

  // Comments first: forum counts come from valid references to existing forums
  for (const { id, fields } of comments) {
    const path = `comments/${id}`;
    const forumId = fields.forumId;
    if (forumId === undefined) manual(path, "comment_forum_id_invalid", "forumId", "missing");
    else if (typeof forumId !== "string") manual(path, "comment_forum_id_invalid", "forumId", `type:${typeOf(forumId)}`);
    else if (forumId === "") manual(path, "comment_forum_id_invalid", "forumId", "empty");
    else if (!forumIds.has(forumId)) manual(path, "comment_orphaned", "forumId", "parent_not_found");
    else counted.set(forumId, (counted.get(forumId) ?? 0) + 1);
    moderation(path, fields.moderationPolicy, "comment_moderation_unknown", "comment_moderation_unrecognized");
  }

  for (const { id, fields } of forums) {
    const path = `forums/${id}`;
    const set: Record<string, PatchValue> = {};
    const expect: Record<string, Expectation> = {};
    const reasons: Category[] = [];
    const propose = (field: string, value: PatchValue, reason: Category) => {
      set[field] = value;
      expect[field] = expectationOf(fields[field]);
      reasons.push(reason);
      flag(reason, path);
    };

    // Visibility: missing already means active / not deleted (rules and
    // canViewForum), so only a missing field gets that default
    for (const [field, fallback, missing] of [
      ["isActive", true, "forum_is_active_missing"],
      ["isAdminDeleted", false, "forum_is_admin_deleted_missing"],
    ] as const) {
      const value = fields[field];
      if (value === undefined) propose(field, fallback, missing);
      else if (typeof value !== "boolean") manual(path, "forum_visibility_invalid_type", field, `type:${typeOf(value)}`);
    }

    // endTime: missing means open indefinitely (acceptsComments), which may be intended
    const endTime = fields.endTime;
    if (endTime === undefined) manual(path, "forum_end_time_missing", "endTime", "open_indefinitely");
    else if (typeof endTime === "string") {
      const parsed = parseEndTimeString(endTime);
      if (parsed.ok) {
        set.endTime = { $timestamp: parsed.iso };
        expect.endTime = { type: "string", value: endTime }; // a valid ISO date, not free text
        reasons.push("forum_end_time_string_convertible");
        flag("forum_end_time_string_convertible", path);
      } else manual(path, "forum_end_time_invalid", "endTime", parsed.reason);
    } else if (!isTimestamp(endTime)) manual(path, "forum_end_time_invalid", "endTime", `type:${typeOf(endTime)}`);

    // commentCount: reconcile to the counted comments when missing, invalid or different
    const stored = fields.commentCount;
    const actual = counted.get(id) ?? 0;
    if (stored === undefined) propose("commentCount", actual, "forum_comment_count_missing");
    else if (!isValidCount(stored)) propose("commentCount", actual, "forum_comment_count_invalid");
    else if (stored !== actual) propose("commentCount", actual, "forum_comment_count_mismatch");

    moderation(path, fields.moderationPolicy, "forum_moderation_unknown", "forum_moderation_unrecognized");
    if (reasons.length > 0) corrections.push({ path, set, expect, reasons });
  }

  for (const c of CATEGORIES) findings[c].sort(byPath);
  const affected = new Set(CATEGORIES.flatMap((c) => findings[c]));
  const affectedForums = [...affected].filter((p) => p.startsWith("forums/")).length;

  return {
    tool: "legacy-data-audit",
    reportVersion: 1,
    mode: "read-only",
    writesPerformed: 0,
    recognizedModerationPolicies: RECOGNIZED_MODERATION_POLICIES,
    inspected: { forums: forums.length, comments: comments.length },
    findingCounts: Object.fromEntries(CATEGORIES.map((c) => [c, findings[c].length])) as Record<Category, number>,
    findings,
    affectedDocuments: { forums: affectedForums, comments: affected.size - affectedForums, total: affected.size },
    proposedCorrections: corrections.sort((a, b) => byPath(a.path, b.path)),
    manualReview: manualReview.sort(
      (a, b) => byPath(a.path, b.path) || byPath(a.category, b.category) || byPath(a.field, b.field)
    ),
    notes: [
      "Nothing was written. Proposed corrections are a plan only.",
      "commentCount values come from this one scan and can be stale if comments are published or deleted meanwhile; a future apply must re-check each value against its expectation in a transaction.",
      "A missing or unrecognized moderationPolicy means moderation provenance is unknown, not that the content is unsafe; a recognized marker does not prove the content is safe.",
      "Orphaned comments and comments without a valid forumId are reported only: no parent is inferred and nothing is deleted.",
    ],
  };
}
