/**
 * @jest-environment node
 *
 * The audit's input adapters and the CLI's target checks. Nothing here talks
 * to Firestore: every refusal happens before an SDK is loaded. The emulator
 * read path is covered by tests/firestore-rules/legacy-audit.test.ts.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertSafeEmulatorTarget, fixtureToInput, readEmulator, UnsafeTargetError } from "../sources";

const CLI = join(__dirname, "..", "cli.mjs");
const FIXTURE = join(__dirname, "..", "fixtures", "legacy-sample.json");

/** Runs the real CLI with a clean environment (no inherited emulator or credential variables). */
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });

describe("assertSafeEmulatorTarget", () => {
  it.each([
    ["127.0.0.1:8080", "demo-devtalk"],
    ["localhost:8080", "demo-devtalk"],
    ["[::1]:8080", "demo-test-1"],
  ])("accepts %s with %s", (host, projectId) => {
    expect(assertSafeEmulatorTarget({ FIRESTORE_EMULATOR_HOST: host }, projectId)).toEqual({ host, projectId });
  });

  it.each([
    ["no emulator host", {}, "demo-devtalk"],
    ["a remote host", { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" }, "demo-devtalk"],
    ["a LAN address", { FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" }, "demo-devtalk"],
    ["a lookalike host", { FIRESTORE_EMULATOR_HOST: "localhost.evil.com:8080" }, "demo-devtalk"],
    ["no port", { FIRESTORE_EMULATOR_HOST: "localhost" }, "demo-devtalk"],
    ["the production project", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, "devtalk-88046"],
    ["no project", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, undefined],
    ["a project that only contains demo", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, "prod-demo-x"],
  ])("refuses %s", (_label, env, projectId) => {
    expect(() => assertSafeEmulatorTarget(env, projectId)).toThrow(UnsafeTargetError);
  });

  describe("readEmulator validates the environment the SDK actually reads", () => {
    const saved = process.env.FIRESTORE_EMULATOR_HOST;
    afterEach(() => {
      if (saved === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
      else process.env.FIRESTORE_EMULATOR_HOST = saved;
    });

    it.each([
      ["unset", undefined],
      ["a remote host", "firestore.googleapis.com:443"],
      ["a LAN address", "10.0.0.5:8080"],
    ])("refuses when process.env has %s, before loading the Admin SDK", async (_label, host) => {
      if (host === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
      else process.env.FIRESTORE_EMULATOR_HOST = host;
      // There is no separate environment argument that could disagree with process.env
      expect(readEmulator.length).toBe(1);
      await expect(readEmulator("demo-devtalk")).rejects.toBeInstanceOf(UnsafeTargetError);
    });

    it("refuses a non-demo project even with a loopback host", async () => {
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      await expect(readEmulator("devtalk-88046")).rejects.toBeInstanceOf(UnsafeTargetError);
    });
  });
});

describe("fixtureToInput", () => {
  it("keeps only the audited fields and revives fixture timestamps", () => {
    const input = fixtureToInput({
      forums: { f: { title: "secret", creatorName: "Pat", isActive: true, endTime: { $timestamp: "2026-01-01T00:00:00Z" } } },
      comments: { c: { content: "secret", userId: "u1", forumId: "f" } },
    });
    expect(Object.keys(input.forums[0].fields).sort()).toEqual(["endTime", "isActive"]);
    expect((input.forums[0].fields.endTime as { toMillis(): number }).toMillis()).toBe(Date.UTC(2026, 0, 1));
    expect(input.comments[0].fields).toEqual({ forumId: "f" });
  });

  it("rejects malformed fixtures", () => {
    expect(() => fixtureToInput({ forums: [], comments: {} })).toThrow();
    expect(() => fixtureToInput({ forums: { f: { endTime: { $timestamp: "not a date" } } }, comments: {} })).toThrow();
  });
});

describe("cli.mjs", () => {
  it("audits a local fixture and prints a read-only report", () => {
    const result = run(["--fixture", FIXTURE]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ mode: "read-only", writesPerformed: 0, source: { kind: "fixture" } });
    expect(report.inspected).toEqual({ forums: 10, comments: 9 });
    expect(result.stdout).not.toContain("PRIVATE-TEXT");
    expect(result.stdout).not.toContain(FIXTURE); // only the file name is reported
  });

  it.each([
    ["no target", []],
    ["an apply flag", ["--fixture", FIXTURE, "--apply"]],
    ["a production flag", ["--production"]],
    ["two targets", ["--fixture", FIXTURE, "--emulator", "--project", "demo-devtalk"]],
    ["the emulator without FIRESTORE_EMULATOR_HOST", ["--emulator", "--project", "demo-devtalk"]],
    ["a non-demo project", ["--emulator", "--project", "devtalk-88046"]],
  ])("refuses %s, prints no report and exits non-zero", (_label, args) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/refus|usage/i);
  });

  it("refuses an emulator host that isn't loopback, even with a demo project", () => {
    const result = run(["--emulator", "--project", "demo-devtalk"], { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });

  it("refuses the emulator target when production credentials are present in the environment", () => {
    const result = run(["--emulator", "--project", "demo-devtalk"], {
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/credential/i);
  });
});
