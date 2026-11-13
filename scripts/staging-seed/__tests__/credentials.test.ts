/**
 * @jest-environment node
 *
 * The seed's private credentials file (credentials.ts): reserved exclusively
 * outside the repository, written completely or not at all, each password
 * saved before it is used, one writer at a time, validated on resume, and
 * never echoed in errors. Uses temporary directories, child processes and
 * synthetic passwords only.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  CREDENTIALS_FORMAT,
  CredentialsFileError,
  openCredentialsFile,
  writeAll,
  type CredentialsFileStore,
  type CredentialsIdentity,
  type FileOps,
  type OpenOptions,
} from "../credentials";
import { planSeed } from "../dataset";
import { planDigest } from "../seed";

const REPO = join(__dirname, "..", "..", "..");
const CREDENTIALS_TS = join(__dirname, "..", "credentials.ts");
const plan = planSeed(Date.UTC(2026, 5, 1, 12));
const [alice, bob, carol] = plan.users;
const identity: CredentialsIdentity = {
  seed: plan.seed,
  target: { kind: "emulator", projectId: "demo-devtalk" },
  planDigest: planDigest(plan),
  users: plan.users,
};

let dir: string;
let n = 0;
let armed = false;
const opened: CredentialsFileStore[] = [];
const makePassword = () => `synthetic-password-${String(++n).padStart(4, "0")}`;
const open = (path: string | undefined, resume = false, extra: Partial<OpenOptions> & { identity?: CredentialsIdentity } = {}) => {
  const store = openCredentialsFile(path, extra.identity ?? identity, { resume, repoRoot: REPO, makePassword, ...extra });
  opened.push(store);
  return store;
};
const read = (path: string) => JSON.parse(fs.readFileSync(path, "utf8"));
const bytes = (path: string) => fs.readFileSync(path);
const files = () => fs.readdirSync(dir).sort();
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialsFileError);
    return (error as Error).message;
  }
  throw new Error("expected a CredentialsFileError");
};

/** File operations whose writes go through `writer` once `armed()` is true (by default, always). */
function writes(writer: (fd: number, data: Buffer, offset: number, length: number) => number, armed: () => boolean = () => true): FileOps {
  return {
    ...fs,
    writeSync: ((fd: number, data: Buffer, offset?: number, length?: number) => {
      const start = offset ?? 0;
      const count = length ?? data.length - start;
      return armed() ? writer(fd, data, start, count) : fs.writeSync(fd, data, start, count);
    }) as unknown as FileOps["writeSync"],
  };
}
/** Writes at most `max` bytes per call, like a short write. */
const atMost = (max: number, log?: number[]) => (fd: number, data: Buffer, offset: number, length: number) => {
  const written = fs.writeSync(fd, data, offset, Math.min(length, max));
  log?.push(written);
  return written;
};

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "seed-credentials-"));
});
afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("reserving a new credentials file", () => {
  it("creates it empty, mode 0600, holding its lock until closed", () => {
    const path = join(dir, "creds.json");
    const store = open(path);
    expect(fs.statSync(path).mode & 0o777).toBe(0o600);
    const file = read(path);
    expect(file).toMatchObject({ format: CREDENTIALS_FORMAT, version: 1, seed: plan.seed, target: identity.target, planDigest: identity.planDigest, accounts: {} });
    expect(file.fileId).toMatch(/^[0-9a-f]{32}$/);
    expect(store.id).toBe(file.fileId);
    expect(store.summary()).toEqual({ path: fs.realpathSync(path), fileId: file.fileId, created: 0, pending: 0, generatedThisRun: 0 });
    expect(files()).toEqual(["creds.json", "creds.json.lock"]);
    expect(fs.statSync(`${path}.lock`).mode & 0o777).toBe(0o600);
    expect(read(`${path}.lock`)).toMatchObject({ pid: process.pid, host: hostname() });

    store.close();
    store.close(); // idempotent
    expect(files()).toEqual(["creds.json"]);
    expect(refusal(() => store.passwordFor(alice))).toContain("closed");
  });

  it("refuses an existing file and leaves it unchanged", () => {
    const path = join(dir, "creds.json");
    fs.writeFileSync(path, "someone else's notes\n");
    expect(refusal(() => open(path))).toContain("already exists");
    expect(fs.readFileSync(path, "utf8")).toBe("someone else's notes\n");
    expect(files()).toEqual(["creds.json"]); // no lock or temporary file left
  });

  it("refuses a symlink at the path without following it", () => {
    const target = join(dir, "elsewhere.txt");
    fs.writeFileSync(target, "untouched\n");
    const path = join(dir, "creds.json");
    fs.symlinkSync(target, path);
    expect(refusal(() => open(path))).toContain("already exists");
    expect(fs.readFileSync(target, "utf8")).toBe("untouched\n");
  });

  it.each([
    ["no path", () => undefined, "path is required"],
    ["a missing directory", () => join(dir, "missing", "creds.json"), "does not exist"],
    ["a directory that is a file", () => (fs.writeFileSync(join(dir, "f"), ""), join(dir, "f", "creds.json")), "does not exist"],
    ["a path inside the repository", () => join(REPO, "scripts", "creds.json"), "outside the repository"],
  ])("refuses %s and writes nothing", (_label, pathFor, message) => {
    const path = pathFor();
    const before = files();
    expect(refusal(() => open(path))).toContain(message);
    expect(files()).toEqual(before);
    if (path?.startsWith(REPO)) expect(fs.existsSync(path)).toBe(false);
  });

  it("refuses a repository path reached through a symlinked directory", () => {
    const link = join(dir, "repo-link");
    fs.symlinkSync(REPO, link);
    expect(refusal(() => open(join(link, "creds.json")))).toContain("outside the repository");
    expect(fs.existsSync(join(REPO, "creds.json"))).toBe(false);
    expect(fs.existsSync(join(REPO, "creds.json.lock"))).toBe(false);
  });

  it("creates a complete file through short writes", () => {
    const log: number[] = [];
    const path = join(dir, "creds.json");
    open(path, false, { fs: writes(atMost(7, log)) });
    expect(read(path).accounts).toEqual({});
    expect(log.length).toBeGreaterThan(10);
  });

  it.each([
    ["a write that makes no progress", () => 0],
    ["a short write followed by an error", (() => {
      let calls = 0;
      return (fd: number, data: Buffer, offset: number, length: number) => {
        if (++calls === 1) return fs.writeSync(fd, data, offset, Math.min(length, 10));
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      };
    })()],
  ])("never leaves an incomplete new file after %s", (_label, writer) => {
    let calls = 0;
    const path = join(dir, "creds.json");
    // The lock (first write) is written normally; the file's own writes fail
    const ops = writes(writer as never, () => ++calls > 1);
    expect(refusal(() => open(path, false, { fs: ops }))).toContain("could not be created");
    expect(files()).toEqual([]); // no file, no temporary file, lock released
  });

  it("releases nothing it did not take when the lock itself cannot be written", () => {
    const path = join(dir, "creds.json");
    expect(refusal(() => open(path, false, { fs: writes(() => 0) }))).toContain("lock could not be created");
    expect(files()).toEqual([]);
  });
});

describe("writing completely", () => {
  it("advances by the bytes each write reports, splitting multibyte characters", () => {
    const path = join(dir, "out");
    const text = "pässwörd ✓ 🔑 ünïcødé ".repeat(20);
    const data = Buffer.from(text, "utf8");
    const log: number[] = [];
    const fd = fs.openSync(path, "wx", 0o600);
    writeAll(writes(atMost(3, log)), fd, data);
    fs.closeSync(fd);
    expect(bytes(path).equals(data)).toBe(true);
    expect(fs.readFileSync(path, "utf8")).toBe(text);
    expect(log.reduce((a, b) => a + b, 0)).toBe(data.length);
  });

  it.each([
    ["zero bytes", 0],
    ["a negative count", -1],
    ["more than was asked", 10_000],
  ])("fails instead of looping when a write reports %s", (_label, result) => {
    const fd = fs.openSync(join(dir, "out"), "wx", 0o600);
    try {
      expect(() => writeAll(writes(() => result), fd, Buffer.from("data"))).toThrow("no progress");
    } finally {
      fs.closeSync(fd);
    }
  });

  it("saves multibyte passwords exactly through short writes", () => {
    const path = join(dir, "creds.json");
    const store = open(path, false, { fs: writes(atMost(5)), makePassword: () => "pässwörd-ünïcødé-🔑-✓-synthetic" });
    const password = store.passwordFor(alice);
    expect(read(path).accounts[alice.uid].password).toBe(password);
  });
});

describe("saving passwords", () => {
  it("saves each password as pending before returning it, then marks it created", () => {
    const path = join(dir, "creds.json");
    const store = open(path);
    const password = store.passwordFor(alice);
    expect(read(path).accounts[alice.uid]).toMatchObject({ email: alice.email, password, status: "pending" });
    expect(store.passwordFor(alice)).toBe(password); // same password, not regenerated

    store.markCreated(alice.uid);
    store.markCreated(alice.uid); // idempotent
    expect(read(path).accounts[alice.uid].status).toBe("created");
    expect(store.summary()).toMatchObject({ created: 1, pending: 0, generatedThisRun: 1 });
    expect(fs.statSync(path).mode & 0o777).toBe(0o600);
    expect(files()).toEqual(["creds.json", "creds.json.lock"]); // no temporary files left
  });

  it("keeps a created account's password and marks it pending again when it is recreated", () => {
    const path = join(dir, "creds.json");
    const store = open(path);
    const password = store.passwordFor(alice);
    store.markCreated(alice.uid);
    expect(store.passwordFor(alice)).toBe(password);
    expect(read(path).accounts[alice.uid]).toMatchObject({ password, status: "pending" });
  });

  it("completes an update through several short writes", () => {
    const path = join(dir, "creds.json");
    let armed = false;
    const log: number[] = [];
    const store = open(path, false, { fs: writes(atMost(11, log), () => armed) });
    armed = true;
    const password = store.passwordFor(alice);
    expect(read(path).accounts[alice.uid].password).toBe(password);
    expect(log.length).toBeGreaterThan(5);
  });

  it.each([
    ["a rename failure", (): FileOps => ({ ...fs, renameSync: (a: fs.PathLike, b: fs.PathLike) => { if (armed) throw Object.assign(new Error("EIO"), { code: "EIO" }); fs.renameSync(a, b); } })],
    ["a write that makes no progress", () => writes(() => 0, () => armed)],
    ["a short write followed by an error", () => {
      let calls = 0;
      return writes((fd, data, offset, length) => {
        if (++calls === 1) return fs.writeSync(fd, data, offset, Math.min(length, 20));
        throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
      }, () => armed);
    }],
    ["a flush failure", (): FileOps => ({ ...fs, fsyncSync: (fd: number) => { if (armed) throw Object.assign(new Error("EIO"), { code: "EIO" }); fs.fsyncSync(fd); } })],
  ])("keeps the previous file exactly, and returns no password, after %s", (_label, ops) => {
    const path = join(dir, "creds.json");
    armed = false;
    const store = open(path, false, { fs: ops() });
    const alicePassword = store.passwordFor(alice); // a successful update first
    const before = bytes(path);
    armed = true;
    const message = refusal(() => store.passwordFor(bob));
    expect(message).toMatch(/could not be updated|stopping before creating more accounts/);
    expect(message).not.toContain("synthetic-password");
    expect(bytes(path).equals(before)).toBe(true);
    expect(read(path).accounts[alice.uid].password).toBe(alicePassword);
    expect(files().filter((f) => f.endsWith(".tmp"))).toEqual([]); // the temporary file was removed
    expect(store.summary()).toMatchObject({ pending: 1, generatedThisRun: 1 });
    armed = false;
  });

  it("refuses to mark an account it has no password for", () => {
    const store = open(join(dir, "creds.json"));
    expect(refusal(() => store.markCreated(bob.uid))).toContain("no entry");
  });
});

describe("one writer at a time", () => {
  it("refuses a second open and a second resume while a session holds the file", () => {
    const path = join(dir, "creds.json");
    const a = open(path);
    a.passwordFor(alice);
    const before = bytes(path);
    expect(refusal(() => open(path))).toContain("in use by process");
    expect(refusal(() => open(path, true))).toContain("in use by process");
    expect(bytes(path).equals(before)).toBe(true);
    a.passwordFor(bob);
    expect(Object.keys(read(path).accounts)).toEqual([alice.uid, bob.uid]); // nothing lost
  });

  it("refuses the same file through another path to its directory", () => {
    const path = join(dir, "creds.json");
    open(path);
    const link = join(fs.mkdtempSync(join(tmpdir(), "seed-link-")), "d");
    fs.symlinkSync(dir, link);
    try {
      expect(refusal(() => open(join(link, "creds.json"), true))).toContain("in use");
    } finally {
      fs.rmSync(join(link, ".."), { recursive: true, force: true });
    }
  });

  it("refuses a hard-linked copy, which would have its own lock", () => {
    const path = join(dir, "creds.json");
    open(path).close();
    fs.linkSync(path, join(dir, "copy.json"));
    expect(refusal(() => open(join(dir, "copy.json"), true))).toContain("hard links");
  });

  it("can be reopened after close, with nothing lost or regenerated", () => {
    const path = join(dir, "creds.json");
    const a = open(path);
    const alicePassword = a.passwordFor(alice);
    a.close();
    const b = open(path, true);
    expect(b.passwordFor(alice)).toBe(alicePassword);
    b.passwordFor(bob);
    b.close();
    expect(read(path).accounts[alice.uid].password).toBe(alicePassword);
    expect(Object.keys(read(path).accounts)).toEqual([alice.uid, bob.uid]);
    expect(files()).toEqual(["creds.json"]);
  });

  it("releases the lock when a resume is refused", () => {
    const path = join(dir, "creds.json");
    open(path).close();
    fs.chmodSync(path, 0o644);
    expect(refusal(() => open(path, true))).toContain("mode 0600");
    expect(files()).toEqual(["creds.json"]);
  });

  it("stops writing, and leaves the new lock alone, when its lock was taken over", () => {
    const path = join(dir, "creds.json");
    const a = open(path);
    fs.unlinkSync(`${path}.lock`); // someone removed a live lock by hand...
    const b = open(path, true); // ...and another session took it
    expect(refusal(() => a.passwordFor(alice))).toContain("no longer holds");
    a.close();
    expect(fs.existsSync(`${path}.lock`)).toBe(true); // b's lock survives a's close
    b.passwordFor(bob);
    expect(Object.keys(read(path).accounts)).toEqual([bob.uid]);
  });

  it("stops writing when the file was changed outside the session", () => {
    const path = join(dir, "creds.json");
    const a = open(path);
    fs.writeFileSync(path, JSON.stringify({ ...read(path), note: "edited" }));
    expect(refusal(() => a.passwordFor(alice))).toContain("changed outside this session");
  });
});

describe("a lock left by a killed process", () => {
  /** Runs credentials.ts in a child process: opens the file, saves Alice's password, then stays alive or kills itself. */
  const holder = (path: string, then: "die" | "wait"): ChildProcess => {
    const script = `
      import { openCredentialsFile } from ${JSON.stringify(CREDENTIALS_TS)};
      const identity = ${JSON.stringify(identity)};
      const store = openCredentialsFile(${JSON.stringify(path)}, identity, { resume: false, repoRoot: ${JSON.stringify(REPO)} });
      store.passwordFor(identity.users[0]);
      process.stdout.write("ready\\n");
      if (${JSON.stringify(then)} === "die") process.kill(process.pid, "SIGKILL");
      else setInterval(() => {}, 1000);
    `;
    return spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  };
  const ready = (child: ChildProcess) =>
    new Promise<void>((resolveReady, reject) => {
      child.stdout!.on("data", (d) => String(d).includes("ready") && resolveReady());
      child.on("exit", () => setTimeout(resolveReady, 50));
      child.on("error", reject);
    });
  const exited = (child: ChildProcess) => new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r(null) : child.on("exit", r)));

  it("is refused, then recovered explicitly once its owner is gone, keeping the saved password", async () => {
    const path = join(dir, "creds.json");
    const child = holder(path, "die");
    await ready(child);
    await exited(child);
    expect(child.signalCode).toBe("SIGKILL");
    const saved = read(path).accounts[alice.uid].password;
    expect(read(`${path}.lock`).pid).toBe(child.pid);

    // Not recovered implicitly, however old it is
    expect(refusal(() => open(path, true))).toContain("--recover-stale-lock");
    const store = open(path, true, { recoverStaleLock: true });
    expect(store.passwordFor(alice)).toBe(saved);
    expect(read(`${path}.lock`).pid).toBe(process.pid);
    store.close();
    expect(files()).toEqual(["creds.json"]);
  });

  it("refuses to recover the lock of a process that is still running", async () => {
    const path = join(dir, "creds.json");
    const child = holder(path, "wait");
    try {
      await ready(child);
      const before = bytes(`${path}.lock`);
      expect(refusal(() => open(path, true, { recoverStaleLock: true }))).toContain("still running");
      expect(bytes(`${path}.lock`).equals(before)).toBe(true);
    } finally {
      child.kill("SIGKILL");
      await exited(child);
    }
  });

  it.each([
    ["another host", (path: string) => fs.writeFileSync(`${path}.lock`, JSON.stringify({ ...read(`${path}.lock`), host: "some-other-host" })), "another host"],
    ["an unreadable lock", (path: string) => fs.writeFileSync(`${path}.lock`, ""), "unreadable"],
    ["a process whose state cannot be checked", () => undefined, "cannot tell"],
  ])("refuses to recover a lock from %s", (_label, change, message) => {
    const path = join(dir, "creds.json");
    open(path).close();
    fs.writeFileSync(`${path}.lock`, JSON.stringify({ format: "devtalk-staging-seed-credentials-lock", token: "t", pid: 999_999, host: hostname(), startedAt: "then" }));
    change(path);
    const before = bytes(`${path}.lock`);
    expect(refusal(() => open(path, true, { recoverStaleLock: true, probeProcess: () => "unknown" }))).toContain(message);
    expect(bytes(`${path}.lock`).equals(before)).toBe(true);
  });

  it("does not trust a PID alone: a live process with the recorded PID blocks recovery", () => {
    const path = join(dir, "creds.json");
    open(path).close();
    // A dead owner whose PID now belongs to a live process (here, this test runner)
    fs.writeFileSync(`${path}.lock`, JSON.stringify({ format: "devtalk-staging-seed-credentials-lock", token: "t", pid: process.pid, host: hostname(), startedAt: "then" }));
    expect(refusal(() => open(path, true, { recoverStaleLock: true }))).toContain("still running");
  });
});

describe("resuming with an existing file", () => {
  const prepared = () => {
    const path = join(dir, "creds.json");
    const first = open(path);
    const alicePassword = first.passwordFor(alice);
    first.markCreated(alice.uid);
    const bobPassword = first.passwordFor(bob);
    first.close();
    return { path, alicePassword, bobPassword, id: first.id };
  };

  it("reuses saved passwords, keeps the file id, and counts only new passwords as this run's", () => {
    const { path, alicePassword, bobPassword, id } = prepared();
    const resumed = open(path, true);
    expect(resumed.id).toBe(id);
    expect(resumed.summary()).toMatchObject({ created: 1, pending: 1, generatedThisRun: 0 });
    expect(resumed.passwordFor(bob)).toBe(bobPassword);
    expect(resumed.passwordFor(carol)).not.toBe(alicePassword);
    expect(resumed.summary()).toMatchObject({ created: 1, pending: 2, generatedThisRun: 1 });
    const runs = new Set(Object.values(read(path).accounts).map((e) => (e as { runId: string }).runId));
    expect(runs.size).toBe(2);
  });

  it("needs the file to exist", () => {
    expect(refusal(() => open(join(dir, "creds.json"), true))).toContain("needs an existing");
    expect(files()).toEqual([]);
  });

  it.each([
    ["another seed", (f: Record<string, unknown>) => ({ ...f, seed: "staging-seed-v2" })],
    ["another target", (f: Record<string, unknown>) => ({ ...f, target: { kind: "staging", projectId: "devtalk-staging" } })],
    ["another plan", (f: Record<string, unknown>) => ({ ...f, planDigest: "0".repeat(64) })],
    ["another format", (f: Record<string, unknown>) => ({ ...f, format: "something-else" })],
    ["a missing file id", (f: Record<string, unknown>) => ({ ...f, fileId: undefined })],
    ["an unplanned account", (f: Record<string, unknown>) => ({ ...f, accounts: { ...(f.accounts as object), "real-user": { email: "real@example.test", password: "x".repeat(20), status: "pending" } } })],
    ["a mismatched email", (f: Record<string, unknown>) => ({ ...f, accounts: { [alice.uid]: { email: bob.email, password: "x".repeat(20), status: "pending" } } })],
    ["a short password", (f: Record<string, unknown>) => ({ ...f, accounts: { [alice.uid]: { email: alice.email, password: "short", status: "pending" } } })],
    ["an unknown status", (f: Record<string, unknown>) => ({ ...f, accounts: { [alice.uid]: { email: alice.email, password: "x".repeat(20), status: "adopted" } } })],
  ])("refuses a file written for %s and leaves it unchanged", (_label, change) => {
    const { path } = prepared();
    fs.writeFileSync(path, JSON.stringify(change(read(path))), { mode: 0o600 });
    const before = fs.readFileSync(path, "utf8");
    expect(refusal(() => open(path, true))).toContain("another seed, target or plan");
    expect(fs.readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses a file that is not a seed credentials file", () => {
    const path = join(dir, "notes.txt");
    fs.writeFileSync(path, "not json", { mode: 0o600 });
    expect(refusal(() => open(path, true))).toContain("not a seed credentials file");
  });

  it("refuses a file other users can read", () => {
    const { path } = prepared();
    fs.chmodSync(path, 0o644);
    expect(refusal(() => open(path, true))).toContain("mode 0600");
  });

  it("refuses a symlink", () => {
    const { path } = prepared();
    const link = join(dir, "link.json");
    fs.symlinkSync(path, link);
    expect(refusal(() => open(link, true))).toContain("not a regular file");
  });

  it("refuses the same file under a different identity's resume", () => {
    const { path } = prepared();
    const other = { ...identity, target: { kind: "staging", projectId: "devtalk-staging" } };
    expect(refusal(() => open(path, true, { identity: other }))).toContain("another seed, target or plan");
  });

  it("never puts a password in an error message", () => {
    const { path, alicePassword } = prepared();
    const messages: string[] = [];
    fs.writeFileSync(path, JSON.stringify({ ...read(path), seed: "other" }), { mode: 0o600 });
    messages.push(refusal(() => open(path, true)));
    messages.push(refusal(() => open(path)));
    for (const message of messages) expect(message).not.toContain(alicePassword);
  });
});

describe("as a separate process", () => {
  it("runs under plain Node (the CLI imports this file directly)", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { writeAll } from ${JSON.stringify(CREDENTIALS_TS)}; console.log(typeof writeAll);`], { encoding: "utf8" });
    expect(result.stdout.trim()).toBe("function");
  });
});
