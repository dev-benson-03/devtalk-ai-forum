#!/usr/bin/env node
/**
 * Legacy-data audit (read-only). Prints a JSON report to stdout.
 *
 *   node scripts/legacy-audit/cli.mjs --fixture <file.json>
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node scripts/legacy-audit/cli.mjs --emulator --project demo-devtalk
 *
 * There is no apply, write or production mode. Any other flag, a missing or
 * non-loopback emulator host, a non-demo project, or credentials in the
 * environment make it refuse (exit 2) before any Firestore access.
 * Node 22.18+ runs the TypeScript modules directly (type stripping).
 * See docs/architecture/legacy-data.md.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { auditLegacyData } from "./audit.ts";
import { assertSafeEmulatorTarget, fixtureToInput, readEmulator } from "./sources.ts";

const USAGE = "usage: cli.mjs --fixture <file.json> | --emulator --project demo-<name>";
const CREDENTIAL_VARIABLES = ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_ADMIN_PRIVATE_KEY", "FIREBASE_ADMIN_CLIENT_EMAIL"];

function refuse(message) {
  process.stderr.write(`Refusing to run: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { fixture: undefined, emulator: false, project: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture" && argv[i + 1] && !argv[i + 1].startsWith("--")) args.fixture = argv[++i];
    else if (arg === "--project" && argv[i + 1] && !argv[i + 1].startsWith("--")) args.project = argv[++i];
    else if (arg === "--emulator") args.emulator = true;
    else refuse(`unknown or incomplete argument "${arg}" (this tool has no apply or production mode)`);
  }
  if (Boolean(args.fixture) === args.emulator) refuse("choose exactly one of --fixture or --emulator");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let input;
  let source;
  if (args.fixture) {
    input = fixtureToInput(JSON.parse(readFileSync(args.fixture, "utf8")));
    source = { kind: "fixture", file: basename(args.fixture) };
  } else {
    const present = CREDENTIAL_VARIABLES.filter((name) => process.env[name]);
    if (present.length > 0) refuse(`credential variables are set (${present.join(", ")}); unset them for an emulator audit`);
    let target;
    try {
      target = assertSafeEmulatorTarget(process.env, args.project);
    } catch (error) {
      refuse(error.message);
    }
    input = await readEmulator(target.projectId);
    source = { kind: "emulator", host: target.host, projectId: target.projectId };
  }
  const report = auditLegacyData(input);
  process.stdout.write(`${JSON.stringify({ source, ...report }, null, 2)}\n`);
}

main().catch((error) => {
  // Error names only: never stored values or document contents
  process.stderr.write(`Audit failed: ${error?.name ?? "Error"}\n`);
  process.exit(1);
});
