/**
 * Planning for the emulator-only visibility rehearsal: which forums are
 * missing isActive or isAdminDeleted, and the default each one gets.
 *
 * The decision itself comes from the read-only legacy audit
 * (auditLegacyData's forum_is_active_missing / forum_is_admin_deleted_missing
 * proposals); this module only narrows its report to those two fields and
 * records the original state of both flags for the backup. Explicit values,
 * null and other types are never planned. The defaults match how the app
 * already reads a missing flag (firestore.rules, canViewForum and
 * acceptsComments): missing isActive = true, missing isAdminDeleted = false.
 *
 * Pure: no I/O. Only type imports, so Node can run it directly (cli.mjs).
 */
import type { AuditReport } from "../legacy-audit/audit";

export const MIGRATION_ID = "forum-visibility-defaults-v1";
export const VISIBILITY_FIELDS = ["isActive", "isAdminDeleted"] as const;
export type VisibilityField = (typeof VISIBILITY_FIELDS)[number];
export const DEFAULTS: Record<VisibilityField, boolean> = { isActive: true, isAdminDeleted: false };

/** A flag's stored state. Only booleans and null are echoed; other types give just their type. */
export type FieldState =
  | { state: "missing" }
  | { state: "present"; value: boolean | null }
  | { state: "present"; type: string };

/** One forum as read for planning: the two flags only, and its update time. */
export interface ObservedForum {
  id: string;
  /** Firestore update time, ISO 8601 with nanoseconds. */
  updateTime: string;
  fields: Record<string, unknown>;
}

export interface PlannedDocument {
  path: string;
  /**
   * Update time when planned (ISO 8601, nine fractional digits). Apply
   * requires the forum's current update time to equal this AND both flags
   * to match `original`; otherwise it skips the document.
   */
  updateTime: string;
  original: Record<VisibilityField, FieldState>;
  set: Partial<Record<VisibilityField, boolean>>;
}

export interface VisibilityPlan {
  inspected: number;
  documents: PlannedDocument[];
  manualReview: { path: string; field: string; detail: string }[];
}

const MISSING_REASONS: Record<VisibilityField, string> = {
  isActive: "forum_is_active_missing",
  isAdminDeleted: "forum_is_admin_deleted_missing",
};

export function fieldState(value: unknown): FieldState {
  if (value === undefined) return { state: "missing" };
  if (value === null || typeof value === "boolean") return { state: "present", value };
  return { state: "present", type: Array.isArray(value) ? "array" : typeof value === "object" ? "map" : typeof value };
}

export const sameFieldState = (a: FieldState, b: FieldState) => JSON.stringify(a) === JSON.stringify(b);

export function planVisibilityDefaults(observed: ObservedForum[], report: AuditReport): VisibilityPlan {
  const byPath = new Map(observed.map((forum) => [`forums/${forum.id}`, forum]));
  const documents: PlannedDocument[] = [];
  for (const correction of report.proposedCorrections) {
    const forum = byPath.get(correction.path);
    if (!forum) continue;
    const set: Partial<Record<VisibilityField, boolean>> = {};
    for (const field of VISIBILITY_FIELDS) {
      // Belt and braces: the audit proposed it, and the field really is missing
      if (correction.reasons.includes(MISSING_REASONS[field] as never) && forum.fields[field] === undefined) {
        set[field] = DEFAULTS[field];
      }
    }
    if (Object.keys(set).length === 0) continue;
    documents.push({
      path: correction.path,
      updateTime: forum.updateTime,
      original: { isActive: fieldState(forum.fields.isActive), isAdminDeleted: fieldState(forum.fields.isAdminDeleted) },
      set,
    });
  }
  const manualReview = report.manualReview
    .filter((item) => item.category === "forum_visibility_invalid_type")
    .map(({ path, field, detail }) => ({ path, field, detail }));
  return { inspected: observed.length, documents, manualReview };
}
