/**
 * Reads, apply, verify and rollback for the emulator-only visibility
 * rehearsal. Every operation calls store.guard() first (see emulator.ts).
 *
 * Atomicity is per document, never per run: each document is corrected or
 * restored in its own transaction, together with its progress record.
 *
 * Progress records live at
 *   visibilityRehearsalRuns/{runId}/documents/{forumId}
 * and are bound to the migration ID, run ID, document path and the verified
 * backup's checksum. A record that doesn't match the backup is never treated
 * as completed work.
 *
 * Ownership for rollback: the progress record is created in the same commit
 * as the correction, so its server-assigned createTime equals the forum's
 * update time after that commit (both are the commit time). Rollback restores
 * a document only if the forum's update time still equals the record's
 * createTime, checked and written in one transaction. Any later write to the
 * forum, even one that restores the same values, changes its update time and
 * makes rollback skip it as a conflict. No client clock is used.
 *
 * A FieldValue.serverTimestamp() field is not used as the marker: on the
 * emulator it resolves to a millisecond value taken before the commit, so it
 * never equals the forum's update time (checked in the emulator tests).
 *
 * Reads of forums use a field mask, so only the two flags (and metadata such
 * as the update time) leave Firestore.
 */
import type { DocumentReference, DocumentSnapshot, Timestamp, Transaction } from "firebase-admin/firestore";
import type { Backup } from "./artifacts";
import type { EmulatorStore } from "./emulator";
import type { FieldState, ObservedForum, PlannedDocument } from "./plan";

const FLAGS = ["isActive", "isAdminDeleted"] as const;
const LEDGER = "visibilityRehearsalRuns";

/** A Firestore Timestamp as ISO 8601 with all nine fractional digits, so equality is exact. */
export function versionOf(ts: Pick<Timestamp, "seconds" | "nanoseconds">): string {
  return `${new Date(ts.seconds * 1000).toISOString().slice(0, 19)}.${String(ts.nanoseconds).padStart(9, "0")}Z`;
}

/** Same rules as plan.ts fieldState (kept local so this module needs only type imports). */
function stateOf(value: unknown): FieldState {
  if (value === undefined) return { state: "missing" };
  if (value === null || typeof value === "boolean") return { state: "present", value };
  return { state: "present", type: Array.isArray(value) ? "array" : typeof value === "object" ? "map" : typeof value };
}
const sameState = (a: FieldState, b: FieldState) => JSON.stringify(a) === JSON.stringify(b);
const flagsOf = (snap: DocumentSnapshot) => Object.fromEntries(FLAGS.map((f) => [f, stateOf(snap.get(f))]));

const forumRef = (store: EmulatorStore, path: string) => store.db.doc(path);
const ledgerRef = (store: EmulatorStore, backup: Backup, path: string) =>
  store.db.collection(LEDGER).doc(backup.runId).collection("documents").doc(path.slice("forums/".length));

const readFlags = (tx: Transaction, ref: DocumentReference) =>
  tx.getAll(ref, { fieldMask: [...FLAGS] }).then(([snap]) => snap);

/** A progress record counts only if it was written by this migration, run and backup for this document. */
function ownRecord(snap: DocumentSnapshot, backup: Backup, doc: PlannedDocument): boolean {
  const data = snap.data();
  return (
    !!data &&
    data.migration === backup.migration &&
    data.runId === backup.runId &&
    data.path === doc.path &&
    data.backupDigest === backup.checksum &&
    JSON.stringify(data.set) === JSON.stringify(doc.set) &&
    (data.state === "applied" || data.state === "restored")
  );
}

// ---- Planning read ----------------------------------------------------------

export async function readForumVisibility(store: EmulatorStore): Promise<ObservedForum[]> {
  store.guard();
  const snapshot = await store.db.collection("forums").select(...FLAGS).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    updateTime: versionOf(doc.updateTime),
    fields: Object.fromEntries(FLAGS.filter((f) => doc.get(f) !== undefined).map((f) => [f, doc.get(f)])),
  }));
}

// ---- Apply --------------------------------------------------------------------

export type ApplySkip = "deleted" | "changed_since_plan" | "foreign_progress_record";
export interface ApplyReport {
  command: "apply";
  runId: string;
  planned: number;
  applied: string[];
  fieldsWritten: number;
  alreadyApplied: string[];
  skipped: { path: string; reason: ApplySkip }[];
}

export interface ApplyHooks {
  /** Test hook: runs after a document's transaction commits (a throw simulates a lost acknowledgement). */
  afterCommit?: (path: string) => void | Promise<void>;
}

export async function applyBackup(store: EmulatorStore, backup: Backup, hooks: ApplyHooks = {}): Promise<ApplyReport> {
  const report: ApplyReport = { command: "apply", runId: backup.runId, planned: backup.documents.length, applied: [], fieldsWritten: 0, alreadyApplied: [], skipped: [] };
  for (const doc of backup.documents) {
    store.guard();
    const outcome = await store.db.runTransaction(async (tx) => {
      const ledger = await tx.get(ledgerRef(store, backup, doc.path));
      if (ledger.exists) return ownRecord(ledger, backup, doc) ? "already_applied" : "foreign_progress_record";
      const forum = await readFlags(tx, forumRef(store, doc.path));
      if (!forum.exists) return "deleted";
      // Version and flags must both be as backed up: a change that was later
      // undone still moves the update time
      const flags = flagsOf(forum);
      if (versionOf(forum.updateTime!) !== doc.updateTime || !FLAGS.every((f) => sameState(flags[f], doc.original[f]))) {
        return "changed_since_plan";
      }
      tx.update(forumRef(store, doc.path), doc.set);
      tx.create(ledgerRef(store, backup, doc.path), {
        migration: backup.migration,
        runId: backup.runId,
        path: doc.path,
        backupDigest: backup.checksum,
        set: doc.set,
        state: "applied",
      });
      return "applied";
    });
    if (outcome === "applied") {
      report.applied.push(doc.path);
      report.fieldsWritten += Object.keys(doc.set).length;
      await hooks.afterCommit?.(doc.path);
    } else if (outcome === "already_applied") report.alreadyApplied.push(doc.path);
    else report.skipped.push({ path: doc.path, reason: outcome });
  }
  return report;
}

// ---- Rollback -------------------------------------------------------------------

export type RollbackConflict = "deleted" | "changed_after_apply" | "foreign_progress_record";
export interface RollbackReport {
  command: "rollback";
  runId: string;
  restored: string[];
  fieldsRestored: number;
  alreadyRestored: string[];
  notApplied: string[];
  conflicts: { path: string; reason: RollbackConflict }[];
}

export async function rollbackBackup(store: EmulatorStore, backup: Backup): Promise<RollbackReport> {
  const report: RollbackReport = { command: "rollback", runId: backup.runId, restored: [], fieldsRestored: 0, alreadyRestored: [], notApplied: [], conflicts: [] };
  for (const doc of backup.documents) {
    store.guard();
    const outcome = await store.db.runTransaction(async (tx) => {
      const ledger = await tx.get(ledgerRef(store, backup, doc.path));
      if (!ledger.exists) return "not_applied";
      if (!ownRecord(ledger, backup, doc)) return "foreign_progress_record";
      if (ledger.get("state") === "restored") return "already_restored";
      const forum = await readFlags(tx, forumRef(store, doc.path));
      // Never recreate a document deleted after the migration
      if (!forum.exists) return "deleted";
      if (!forum.updateTime!.isEqual(ledger.createTime!)) return "changed_after_apply";
      // Every corrected field was missing before (validated in the backup)
      tx.update(forumRef(store, doc.path), Object.fromEntries(Object.keys(doc.set).map((f) => [f, store.deleteField()])));
      // Same commit: the record's update time becomes the restore's commit time
      tx.update(ledgerRef(store, backup, doc.path), { state: "restored" });
      return "restored";
    });
    if (outcome === "restored") {
      report.restored.push(doc.path);
      report.fieldsRestored += Object.keys(doc.set).length;
    } else if (outcome === "already_restored") report.alreadyRestored.push(doc.path);
    else if (outcome === "not_applied") report.notApplied.push(doc.path);
    else report.conflicts.push({ path: doc.path, reason: outcome });
  }
  return report;
}

// ---- Verify (read-only) ----------------------------------------------------------

export type VerifyStatus =
  | "pending"
  | "changed_since_plan"
  | "deleted"
  | "applied"
  | "changed_after_apply"
  | "restored"
  | "changed_after_restore"
  | "foreign_progress_record";

export interface VerifyReport {
  command: "verify";
  runId: string;
  counts: Partial<Record<VerifyStatus, number>>;
  documents: { path: string; status: VerifyStatus }[];
}

export async function verifyRun(store: EmulatorStore, backup: Backup): Promise<VerifyReport> {
  const documents: VerifyReport["documents"] = [];
  for (const doc of backup.documents) {
    store.guard();
    const [ledger, forum] = await Promise.all([
      ledgerRef(store, backup, doc.path).get(),
      store.db.getAll(forumRef(store, doc.path), { fieldMask: [...FLAGS] }).then(([snap]) => snap),
    ]);
    let status: VerifyStatus;
    if (!ledger.exists) {
      const flags = forum.exists ? flagsOf(forum) : undefined;
      status = !forum.exists
        ? "deleted"
        : versionOf(forum.updateTime!) === doc.updateTime && FLAGS.every((f) => sameState(flags![f], doc.original[f]))
          ? "pending"
          : "changed_since_plan";
    } else if (!ownRecord(ledger, backup, doc)) status = "foreign_progress_record";
    else if (!forum.exists) status = "deleted";
    else if (ledger.get("state") === "applied") {
      const exact = forum.updateTime!.isEqual(ledger.createTime!) && Object.entries(doc.set).every(([f, v]) => forum.get(f) === v);
      status = exact ? "applied" : "changed_after_apply";
    } else {
      status = Object.keys(doc.set).every((f) => forum.get(f) === undefined) ? "restored" : "changed_after_restore";
    }
    documents.push({ path: doc.path, status });
  }
  const counts: VerifyReport["counts"] = {};
  for (const { status } of documents) counts[status] = (counts[status] ?? 0) + 1;
  return { command: "verify", runId: backup.runId, counts, documents };
}
