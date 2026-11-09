/**
 * The rehearsal's backup artifact: a JSON file written once, before any
 * correction, and read back and validated before every apply, verify and
 * rollback. It holds only document paths, update times and the states of
 * the two visibility flags (never content, names, emails or credentials).
 *
 * It survives process restarts because it is a file, and it is bound to one
 * run by its run ID, emulator project and host, migration ID and a SHA-256
 * checksum over a canonical serialization. A file that exists is never
 * overwritten.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { FieldState, PlannedDocument, VisibilityPlan } from "./plan";

export const BACKUP_KIND = "devtalk-visibility-rehearsal-backup";
export const BACKUP_VERSION = 1;
// Kept in step with plan.ts (type-only imports keep these modules runnable by Node directly)
const MIGRATION_ID = "forum-visibility-defaults-v1";
const DEFAULTS: Record<string, boolean> = { isActive: true, isAdminDeleted: false };

export interface BackupTarget {
  projectId: string;
  emulatorHost: string;
}

export interface Backup extends BackupTarget {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  migration: string;
  runId: string;
  createdAt: string;
  documents: PlannedDocument[];
  checksum: string;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/** JSON with object keys sorted at every level, so the checksum ignores key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export const checksumOf = (body: object) => createHash("sha256").update(canonical(body)).digest("hex");

export function buildBackup(
  plan: Pick<VisibilityPlan, "documents">,
  meta: BackupTarget & { runId: string; createdAt: string }
): Backup {
  const body = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    migration: MIGRATION_ID,
    runId: meta.runId,
    projectId: meta.projectId,
    emulatorHost: meta.emulatorHost,
    createdAt: meta.createdAt,
    documents: plan.documents,
  } as const;
  return { ...body, checksum: checksumOf(body) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (message: string): never => {
  throw new BackupError(`Backup rejected: ${message}`);
};

function checkState(value: unknown, where: string): FieldState {
  if (!isObject(value)) return fail(`${where} is not a field state`);
  const keys = Object.keys(value).sort().join(",");
  if (value.state === "missing" && keys === "state") return value as FieldState;
  if (value.state === "present" && keys === "state,value" && (value.value === null || typeof value.value === "boolean")) return value as FieldState;
  if (value.state === "present" && keys === "state,type" && typeof value.type === "string") return value as FieldState;
  return fail(`${where} is not a valid field state`);
}

/** Throws BackupError unless `raw` is an intact backup for exactly this emulator target. */
export function validateBackup(raw: unknown, target: BackupTarget): Backup {
  if (!isObject(raw)) return fail("not an object");
  const { checksum, ...body } = raw;
  if (typeof checksum !== "string" || checksum !== checksumOf(body)) fail("checksum mismatch (the file was changed or damaged)");
  if (raw.kind !== BACKUP_KIND || raw.version !== BACKUP_VERSION) fail("unknown kind or version");
  if (raw.migration !== MIGRATION_ID) fail(`made for another migration (${String(raw.migration)})`);
  if (typeof raw.runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw.runId)) fail("invalid run ID");
  if (typeof raw.projectId !== "string" || !/^demo-[a-z0-9-]{1,40}$/.test(raw.projectId)) fail("not a demo-* project");
  if (raw.projectId !== target.projectId) fail(`made for project ${raw.projectId}, not ${target.projectId}`);
  if (raw.emulatorHost !== target.emulatorHost) fail(`made for emulator host ${String(raw.emulatorHost)}, not ${target.emulatorHost}`);
  if (typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt))) fail("invalid createdAt");
  if (!Array.isArray(raw.documents)) fail("documents is not a list");

  const seen = new Set<string>();
  (raw.documents as unknown[]).forEach((doc, i) => {
    const where = `documents[${i}]`;
    if (!isObject(doc) || Object.keys(doc).sort().join(",") !== "original,path,set,updateTime") fail(`${where} has unexpected keys`);
    const d = doc as Record<string, unknown>;
    if (typeof d.path !== "string" || !/^forums\/[^/]+$/.test(d.path)) fail(`${where} is not a forum path`);
    if (seen.has(d.path as string)) fail(`${where} repeats ${String(d.path)}`);
    seen.add(d.path as string);
    if (typeof d.updateTime !== "string") fail(`${where} has no update time`);
    if (!isObject(d.original) || Object.keys(d.original).sort().join(",") !== "isActive,isAdminDeleted") fail(`${where} original must hold both flags`);
    const original = d.original as Record<string, unknown>;
    for (const field of ["isActive", "isAdminDeleted"]) checkState(original[field], `${where}.original.${field}`);
    if (!isObject(d.set) || Object.keys(d.set).length === 0) fail(`${where} has no corrections`);
    for (const [field, value] of Object.entries(d.set as Record<string, unknown>)) {
      if (!(field in DEFAULTS)) fail(`${where} corrects an unrelated field`);
      if (value !== DEFAULTS[field]) fail(`${where} sets ${field} to something other than its default`);
      if ((original[field] as FieldState).state !== "missing") fail(`${where} corrects ${field}, which was not missing`);
    }
  });
  return raw as unknown as Backup;
}

/**
 * Writes the backup only if no file exists at `path` (flag "wx"), then reads
 * it back and validates it. Throws on any failure, so a caller that writes
 * corrections only after this returns never writes without a verified backup.
 */
export function writeBackupFile(path: string, backup: Backup, target: BackupTarget): Backup {
  try {
    writeFileSync(path, `${JSON.stringify(backup, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new BackupError(code === "EEXIST" ? `a backup already exists at this path; refusing to overwrite it` : `could not write the backup (${code ?? "error"})`);
  }
  const reread = readBackupFile(path, target);
  if (canonical(reread) !== canonical(backup)) throw new BackupError("the backup read back differs from what was written");
  return reread;
}

export function readBackupFile(path: string, target: BackupTarget): Backup {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new BackupError(`could not read the backup (${(error as { code?: string }).code ?? "error"})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError("the backup is not valid JSON");
  }
  return validateBackup(parsed, target);
}
