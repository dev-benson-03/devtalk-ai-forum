#!/usr/bin/env node
/**
 * Synthetic staging seed (see dataset.ts and seed.ts).
 *
 *   plan     prints planned record counts; no connection.
 *   verify   read-only status on the target.
 *   apply    creates missing seed accounts and documents. With --resume and
 *            the same credentials file, continues an interrupted run.
 *   cleanup  removes only this seed's documents and the accounts its ledger
 *            proves it created.
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
 * New accounts' passwords go only to --credentials-out (credentials.ts):
 * reserved before connecting (a new file, mode 0600, outside the repository,
 * never overwritten) and updated before each account is created. Pass
 * --resume to continue with a file from an earlier, interrupted run.
 * Nothing secret is printed.
 *
 * apply holds the credentials file's writer lock (<file>.lock) from before
 * it connects until it exits: on success, on any error (including a failed
 * SDK start), and on SIGINT/SIGTERM. Only SIGKILL or a crash leaves it
 * behind; then pass --recover-stale-lock, which is refused unless the lock's
 * process is gone (docs/architecture/staging.md).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planSeed } from "./dataset.ts";
import { CredentialsFileError, openCredentialsFile } from "./credentials.ts";
import { applySeed, cleanupSeed, planDigest, verifySeed } from "./seed.ts";
import { assertKeyFileProject, assertSeedTarget, UnsafeSeedTarget } from "./target.ts";

const USAGE =
  "usage: cli.mjs <plan|verify|apply|cleanup> --target <emulator|staging> --project <id> [--confirm devtalk-staging] [--credentials-out <file> [--resume] [--recover-stale-lock]]";
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
  const args = { command, resume: false, recoverStaleLock: false };
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] === "--resume" || rest[i] === "--recover-stale-lock") {
      args[rest[i] === "--resume" ? "resume" : "recoverStaleLock"] = true;
      i -= 1;
      continue;
    }
    const [flag, value] = [rest[i], rest[i + 1]];
    if (!FLAGS.has(flag) || !value || value.startsWith("--")) refuse(`unknown or incomplete argument "${flag}"`);
    args[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  if (args.resume && command !== "apply") refuse("--resume applies only to apply");
  if (args.recoverStaleLock && command !== "apply") refuse("--recover-stale-lock applies only to apply");
  return args;
}

/**
 * Takes the writer lock and reserves (or, with --resume, reopens) the
 * credentials file, before connecting to anything. On refusal nothing is
 * held: openCredentialsFile releases its lock before throwing.
 */
function openCredentials(args, plan, target) {
  if (!args.credentialsOut) refuse("apply needs --credentials-out <file> for new accounts' passwords");
  const identity = { seed: plan.seed, target: { kind: target.kind, projectId: target.projectId }, planDigest: planDigest(plan), users: plan.users };
  try {
    return openCredentialsFile(args.credentialsOut, identity, { resume: args.resume, recoverStaleLock: args.recoverStaleLock, repoRoot: REPO });
  } catch (error) {
    refuse(error instanceof CredentialsFileError ? `--credentials-out: ${error.message}` : "--credentials-out could not be prepared");
  }
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
    handles: { db, auth: getAuth(app), timestampFromMillis: (ms) => Timestamp.fromMillis(ms), guard, target: { kind: target.kind, projectId: target.projectId } },
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
  // Reserved before connecting: a bad path or a held lock stops the run with nothing written anywhere
  const credentials = args.command === "apply" ? openCredentials(args, plan, target) : undefined;
  if (!credentials) return run(args, plan, target, base);

  // From here the lock is held; every exit path below releases it
  const onSignal = (signal, code) => () => {
    credentials.close();
    process.stderr.write(`Seed stopped by ${signal}. Passwords saved so far are in ${credentials.summary().path}; re-run apply with --resume and the same --credentials-out.\n`);
    process.exit(code);
  };
  const handlers = [["SIGINT", onSignal("SIGINT", 130)], ["SIGTERM", onSignal("SIGTERM", 143)]];
  for (const [signal, handler] of handlers) process.once(signal, handler);
  try {
    await run(args, plan, target, base, credentials);
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    credentials.close();
  }
}

async function run(args, plan, target, base, credentials) {
  // Connecting may fail (e.g. an unusable credential); the caller still releases the lock
  const { handles, close } = await openTarget(target);
  try {
    let report;
    if (args.command === "verify") report = await verifySeed(plan, handles);
    else if (args.command === "cleanup") report = await cleanupSeed(plan, handles);
    else {
      try {
        const result = await applySeed(plan, handles, credentials);
        report = { planned: plan.counts, documents: result.documents, users: result.users, credentials: credentials.summary() };
      } catch (error) {
        const { path } = credentials.summary();
        error.message = `${error.message} Passwords saved so far are in ${path}; once the cause is fixed, re-run apply with --resume and the same --credentials-out.`;
        throw error;
      }
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
