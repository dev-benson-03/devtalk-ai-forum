/**
 * @jest-environment node
 *
 * The rehearsal CLI's refusals and the emulator target check. Every case
 * here fails before firebase-admin is loaded, so nothing talks to Firestore.
 * The emulator end-to-end run is in tests/firestore-rules/visibility-rehearsal.test.ts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeEmulatorTarget, UnsafeTargetError } from "../../legacy-audit/sources";
import { openEmulatorStore, UnsafeRehearsalTarget } from "../emulator";
import { MIGRATION_ID } from "../plan";

const CLI = join(__dirname, "..", "cli.mjs");
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
const backupPath = () => join(mkdtempSync(join(tmpdir(), "visibility-cli-")), "backup.json");
const LOOPBACK = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };

describe("cli.mjs refuses before touching Firestore", () => {
  it.each([
    ["no command", [], LOOPBACK],
    ["an unknown command", ["migrate", "--project", "demo-devtalk", "--backup", "b.json"], LOOPBACK],
    ["a production flag", ["apply", "--production", "--project", "demo-devtalk", "--backup", "b.json"], LOOPBACK],
    ["a missing project", ["plan", "--backup", "b.json"], LOOPBACK],
    ["a missing backup path", ["plan", "--project", "demo-devtalk"], LOOPBACK],
    ["a non-demo project", ["plan", "--project", "devtalk-88046", "--backup", "b.json"], LOOPBACK],
    ["no emulator host", ["plan", "--project", "demo-devtalk", "--backup", "b.json"], {}],
    ["a remote emulator host", ["plan", "--project", "demo-devtalk", "--backup", "b.json"], { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" }],
    ["a LAN emulator host", ["apply", "--project", "demo-devtalk", "--backup", "b.json"], { FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" }],
    ["credential variables", ["rollback", "--project", "demo-devtalk", "--backup", "b.json"], { ...LOOPBACK, GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json" }],
    ["admin key variables", ["verify", "--project", "demo-devtalk", "--backup", "b.json"], { ...LOOPBACK, FIREBASE_ADMIN_PRIVATE_KEY: "x" }],
  ])("refuses %s: exit 2, no report", (_label, args, env) => {
    const result = run(args as string[], env as Record<string, string>);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/refus|usage/i);
  });

  it.each(["apply", "verify", "rollback"])("refuses %s without a readable, valid backup (no writes possible)", (command) => {
    const missing = backupPath();
    const result = run([command, "--project", "demo-devtalk", "--backup", missing], LOOPBACK);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/backup/i);
    expect(existsSync(missing)).toBe(false);
  });
});

describe("openEmulatorStore", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["FIRESTORE_EMULATOR_HOST", "GOOGLE_APPLICATION_CREDENTIALS"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it.each([
    ["unset", undefined, "demo-devtalk", UnsafeTargetError],
    ["remote", "firestore.googleapis.com:443", "demo-devtalk", UnsafeTargetError],
    ["loopback with a non-demo project", "127.0.0.1:8080", "devtalk-88046", UnsafeTargetError],
  ])("validates process.env and refuses %s before loading the SDK", async (_label, host, project, error) => {
    if (host === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = host;
    await expect(openEmulatorStore(project, assertSafeEmulatorTarget)).rejects.toBeInstanceOf(error);
  });

  it("refuses when credential variables are present", async () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/key.json";
    await expect(openEmulatorStore("demo-devtalk", assertSafeEmulatorTarget)).rejects.toBeInstanceOf(UnsafeRehearsalTarget);
  });

  it("names this migration consistently", () => {
    expect(MIGRATION_ID).toBe("forum-visibility-defaults-v1");
  });
});
