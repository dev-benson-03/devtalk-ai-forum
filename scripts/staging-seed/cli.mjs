#!/usr/bin/env node
/**
 * Synthetic staging seed (see dataset.ts and seed.ts).
 *
 *   plan     prints planned record counts; no connection.
 *   verify   read-only status on the target.
 *   apply    creates missing seed accounts and documents (idempotent).
 *   cleanup  removes only this seed's documents and accounts.
 *
 * Emulator rehearsal:
 *   firebase emulators:exec --only auth,firestore --project demo-devtalk \
 *     "node scripts/staging-seed/cli.mjs apply --target emulator --project demo-devtalk --credentials-out <file>"
 *
 * Staging (only after explicit approval):
 *   DEVTALK_FIREBASE_ENV=staging node scripts/staging-seed/cli.mjs apply \
 *     --target staging --project devtalk-staging --confirm devtalk-staging --credentials-out <file>
 *
 * Credentials for staging: Application Default Credentials from
 * `gcloud auth application-default login` (with access to devtalk-staging),
 * or the staging service account's FIREBASE_ADMIN_CLIENT_EMAIL and
 * FIREBASE_ADMIN_PRIVATE_KEY. Production is refused (target.ts).
 *
 * New accounts' passwords go only to --credentials-out: a new file (never
 * overwritten), mode 0600, outside the repository. Nothing secret is printed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { planSeed } from "./dataset.ts";
import { applySeed, cleanupSeed, verifySeed } from "./seed.ts";
import { assertKeyFileProject, assertSeedTarget, UnsafeSeedTarget } from "./target.ts";

const USAGE =
  "usage: cli.mjs <plan|verify|apply|cleanup> --target <emulator|staging> --project <id> [--confirm devtalk-staging] [--credentials-out <file>]";
const COMMANDS = new Set(["plan", "verify", "apply", "cleanup"]);
const FLAGS = new Set(["--target", "--project", "--confirm", "--credentials-out"]);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function refuse(message) {
  process.stderr.write(`Refusing to run: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) refuse(`unknown command "${command ?? ""}"`);
  const args = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (!FLAGS.has(flag) || !value || value.startsWith("--")) refuse(`unknown or incomplete argument "${flag}"`);
    args[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return args;
}

function checkCredentialsOut(path) {
  if (!path) refuse("apply needs --credentials-out <file> for new accounts' passwords");
  const full = resolve(path);
  if (full === REPO || full.startsWith(REPO + sep)) refuse("--credentials-out must be outside the repository");
  if (existsSync(full)) refuse("--credentials-out already exists; choose a new file");
  return full;
}

async function openTarget(target) {
  const { initializeApp, deleteApp, applicationDefault, cert } = await import("firebase-admin/app");
  const { getFirestore, Timestamp } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  const options = { projectId: target.projectId };
  if (target.kind === "staging") {
    options.credential =
      target.credential === "service-account"
        ? cert({
            projectId: target.projectId,
            clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL.trim(),
            privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.trim().replace(/\\n/g, "\n"),
          })
        : applicationDefault();
  } else {
    process.env.METADATA_SERVER_DETECTION = "none";
  }
  const app = initializeApp(options, `staging-seed-${process.pid}`);
  const snapshot = target.kind === "emulator" ? [target.firestoreHost, target.authHost] : [undefined, undefined];
  const guard = () => {
    // The emulator hosts must not change (or appear) after validation
    if (process.env.FIRESTORE_EMULATOR_HOST !== snapshot[0] || process.env.FIREBASE_AUTH_EMULATOR_HOST !== snapshot[1]) {
      throw new UnsafeSeedTarget("emulator variables changed after validation");
    }
  };
  const db = getFirestore(app);
  return {
    handles: { db, auth: getAuth(app), timestampFromMillis: (ms) => Timestamp.fromMillis(ms), guard },
    close: async () => {
      await db.terminate();
      await deleteApp(app);
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = planSeed(Date.now());
  let target;
  try {
    target = assertSeedTarget(args.target, process.env, args);
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (target.kind === "staging" && keyFile) assertKeyFileProject(readFileSync(keyFile, "utf8"), target.projectId);
  } catch (error) {
    refuse(error instanceof UnsafeSeedTarget ? error.message : "target could not be validated");
  }
  const base = { tool: "staging-seed", seed: plan.seed, target: { kind: target.kind, projectId: target.projectId } };

  if (args.command === "plan") {
    process.stdout.write(`${JSON.stringify({ ...base, command: "plan", planned: plan.counts, writesPerformed: 0 }, null, 2)}\n`);
    return;
  }
  const credentialsOut = args.command === "apply" ? checkCredentialsOut(args.credentialsOut) : undefined;

  const { handles, close } = await openTarget(target);
  try {
    let report;
    if (args.command === "verify") report = await verifySeed(plan, handles);
    else if (args.command === "cleanup") report = await cleanupSeed(plan, handles);
    else {
      const result = await applySeed(plan, handles);
      if (result.newCredentials.length > 0) {
        writeFileSync(credentialsOut, `${JSON.stringify(result.newCredentials, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      }
      report = {
        planned: plan.counts,
        documents: result.documents,
        users: result.users,
        newPasswordsWrittenTo: result.newCredentials.length > 0 ? credentialsOut : null,
      };
    }
    process.stdout.write(`${JSON.stringify({ ...base, command: args.command, ...report }, null, 2)}\n`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  process.stderr.write(`Seed failed: ${error?.name ?? "Error"}: ${error?.message ?? "unknown error"}\n`);
  process.exit(1);
});
