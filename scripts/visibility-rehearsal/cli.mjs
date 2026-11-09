#!/usr/bin/env node
/**
 * Emulator-only rehearsal of the forum visibility-flag migration: adds a
 * missing isActive (true) or isAdminDeleted (false), and nothing else.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/visibility-rehearsal/cli.mjs \
 *     <plan|apply|verify|rollback> --project demo-<name> --backup <file.json>
 *
 *   plan      reads the two flags, plans from the legacy audit's proposals,
 *             writes the backup (never overwriting) and reads it back.
 *   apply     verifies the backup, then corrects one document per transaction.
 *   verify    read-only status of every planned document.
 *   rollback  restores missing fields where the migration still owns the document.
 *
 * There is no production mode. Unknown commands or flags, a missing or
 * non-loopback emulator host, a non-demo project, credential variables or an
 * invalid backup make it refuse (exit 2) before any Firestore write; target
 * checks happen before firebase-admin is loaded. Prints a JSON report.
 * See docs/architecture/legacy-data.md.
 */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { auditLegacyData } from "../legacy-audit/audit.ts";
import { assertSafeEmulatorTarget } from "../legacy-audit/sources.ts";
import { BackupError, buildBackup, readBackupFile, writeBackupFile } from "./artifacts.ts";
import { CREDENTIAL_VARIABLES, openEmulatorStore } from "./emulator.ts";
import { planVisibilityDefaults } from "./plan.ts";
import { applyBackup, readForumVisibility, rollbackBackup, verifyRun } from "./rehearsal.ts";

const USAGE = "usage: cli.mjs <plan|apply|verify|rollback> --project demo-<name> --backup <file.json>";
const COMMANDS = new Set(["plan", "apply", "verify", "rollback"]);

function refuse(message) {
  process.stderr.write(`Refusing to run: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) refuse(`unknown command "${command ?? ""}" (this tool has no production mode)`);
  const args = { command, project: undefined, backup: undefined };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = rest[i + 1];
    if ((arg === "--project" || arg === "--backup") && value && !value.startsWith("--")) {
      args[arg.slice(2)] = value;
      i++;
    } else refuse(`unknown or incomplete argument "${arg}"`);
  }
  if (!args.project) refuse("--project is required");
  if (!args.backup) refuse("--backup is required");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const present = CREDENTIAL_VARIABLES.filter((name) => process.env[name]);
  if (present.length > 0) refuse(`credential variables are set (${present.join(", ")}); unset them for an emulator rehearsal`);
  let target;
  try {
    target = assertSafeEmulatorTarget(process.env, args.project);
  } catch (error) {
    refuse(error.message);
  }
  const binding = { projectId: target.projectId, emulatorHost: target.host };

  // Every command except plan needs a verified backup before Firestore is opened
  let backup;
  if (args.command !== "plan") {
    try {
      backup = readBackupFile(args.backup, binding);
    } catch (error) {
      refuse(error instanceof BackupError ? error.message : "backup could not be read");
    }
  }

  const store = await openEmulatorStore(target.projectId, assertSafeEmulatorTarget);
  try {
    let report;
    if (args.command === "plan") {
      const observed = await readForumVisibility(store);
      const plan = planVisibilityDefaults(observed, auditLegacyData({ forums: observed, comments: [] }));
      const built = buildBackup(plan, { ...binding, runId: randomUUID(), createdAt: new Date().toISOString() });
      try {
        backup = writeBackupFile(args.backup, built, binding);
      } catch (error) {
        refuse(error instanceof BackupError ? error.message : "backup could not be written");
      }
      report = {
        command: "plan",
        runId: backup.runId,
        inspected: plan.inspected,
        plannedDocuments: plan.documents.length,
        plannedFields: plan.documents.reduce((n, d) => n + Object.keys(d.set).length, 0),
        manualReview: plan.manualReview,
        backupVerified: true,
        writesPerformed: 0,
      };
    } else if (args.command === "apply") report = await applyBackup(store, backup);
    else if (args.command === "verify") report = await verifyRun(store, backup);
    else report = await rollbackBackup(store, backup);
    const output = { tool: "visibility-rehearsal", migration: backup.migration, target: binding, backupFile: basename(args.backup), ...report };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  process.stderr.write(`Rehearsal failed: ${error?.name ?? "Error"}: ${error?.message ?? "unknown error"}\n`);
  process.exit(1);
});
