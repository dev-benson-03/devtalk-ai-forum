/**
 * @jest-environment node
 *
 * Planning and the backup artifact for the visibility rehearsal. Pure logic
 * and local files only: nothing here talks to Firestore.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditLegacyData } from "../../legacy-audit/audit";
import { BackupError, buildBackup, checksumOf, readBackupFile, validateBackup, writeBackupFile } from "../artifacts";
import { fieldState, planVisibilityDefaults, type ObservedForum } from "../plan";

const FIXTURE = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "visibility-sample.json"), "utf8"));
const VISIBILITY = ["isActive", "isAdminDeleted"];

/** What the emulator read returns: only the two flags, plus an update time. */
const observedFromFixture = (): ObservedForum[] =>
  Object.entries(FIXTURE.forums as Record<string, Record<string, unknown>>).map(([id, data], i) => ({
    id,
    updateTime: `2026-11-09T12:00:${String(i).padStart(2, "0")}.000000000Z`,
    fields: Object.fromEntries(Object.entries(data).filter(([k]) => VISIBILITY.includes(k))),
  }));

const plan = (observed = observedFromFixture()) =>
  planVisibilityDefaults(observed, auditLegacyData({ forums: observed, comments: [] }));

const TARGET = { projectId: "demo-devtalk", emulatorHost: "127.0.0.1:8080" };
const META = { ...TARGET, runId: "8a6e0f0e-1b2c-4d3e-8f40-5a6b7c8d9e0f", createdAt: "2026-11-09T12:00:00.000Z" };
const tmp = () => mkdtempSync(join(tmpdir(), "visibility-rehearsal-"));

describe("fieldState", () => {
  it("distinguishes missing, null, explicit booleans and other types without echoing other values", () => {
    expect(fieldState(undefined)).toEqual({ state: "missing" });
    expect(fieldState(null)).toEqual({ state: "present", value: null });
    expect(fieldState(true)).toEqual({ state: "present", value: true });
    expect(fieldState(false)).toEqual({ state: "present", value: false });
    expect(fieldState("PRIVATE-yes")).toEqual({ state: "present", type: "string" });
    expect(fieldState(0)).toEqual({ state: "present", type: "number" });
  });
});

describe("planVisibilityDefaults", () => {
  it("plans only missing flags, with the defaults the app already applies", () => {
    const result = plan();
    expect(result.inspected).toBe(12);
    expect(result.documents.map((d) => [d.path, d.set])).toEqual([
      ["forums/v-active-missing", { isActive: true }],
      ["forums/v-both-missing", { isActive: true, isAdminDeleted: false }],
      ["forums/v-changed-after-apply", { isActive: true, isAdminDeleted: false }],
      ["forums/v-changed-after-plan", { isActive: true, isAdminDeleted: false }],
      ["forums/v-deleted-after-apply", { isActive: true, isAdminDeleted: false }],
      ["forums/v-deleted-after-plan", { isActive: true }],
      ["forums/v-deleted-missing", { isAdminDeleted: false }],
      ["forums/v-restored-after-plan", { isActive: true, isAdminDeleted: false }],
    ]);
    expect(result.documents.reduce((n, d) => n + Object.keys(d.set).length, 0)).toBe(13);
  });

  it("records the original state of both flags for each planned document", () => {
    const doc = plan().documents.find((d) => d.path === "forums/v-active-missing")!;
    expect(doc.original).toEqual({ isActive: { state: "missing" }, isAdminDeleted: { state: "present", value: false } });
    expect(doc.updateTime).toMatch(/^2026-11-09T12:00:\d{2}\.000000000Z$/);
  });

  it("never plans explicit values, null or invalid types, and lists the last two for manual review", () => {
    const result = plan();
    const planned = new Set(result.documents.map((d) => d.path));
    for (const id of ["v-explicit-listed", "v-explicit-hidden", "v-null", "v-invalid"]) expect(planned.has(`forums/${id}`)).toBe(false);
    expect(result.manualReview).toEqual([
      { path: "forums/v-invalid", field: "isActive", detail: "type:string" },
      { path: "forums/v-invalid", field: "isAdminDeleted", detail: "type:number" },
      { path: "forums/v-null", field: "isActive", detail: "type:null" },
    ]);
  });

  it("plans nothing once the flags are present (a second plan is empty)", () => {
    const observed = observedFromFixture().map((d) => ({
      ...d,
      fields: { isActive: d.fields.isActive === undefined ? true : d.fields.isActive, isAdminDeleted: d.fields.isAdminDeleted === undefined ? false : d.fields.isAdminDeleted },
    }));
    expect(plan(observed).documents).toEqual([]);
  });

  it("contains no content or identity data", () => {
    expect(JSON.stringify(plan())).not.toContain("PRIVATE");
  });
});

describe("backup artifact", () => {
  it("round-trips through a file exactly, with a checksum, and contains no content", () => {
    const backup = buildBackup(plan(), META);
    const file = join(tmp(), "backup.json");
    expect(writeBackupFile(file, backup, TARGET)).toEqual(backup);
    expect(readBackupFile(file, TARGET)).toEqual(backup);
    expect(backup).toMatchObject({ kind: "devtalk-visibility-rehearsal-backup", version: 1, migration: "forum-visibility-defaults-v1", ...META });
    expect(backup.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(file, "utf8")).not.toContain("PRIVATE");
  });

  it("refuses to overwrite an existing file", () => {
    const file = join(tmp(), "backup.json");
    writeFileSync(file, "{}");
    expect(() => writeBackupFile(file, buildBackup(plan(), META), TARGET)).toThrow(/exists/);
    expect(readFileSync(file, "utf8")).toBe("{}");
  });

  it("fails when the directory can't be written", () => {
    expect(() => writeBackupFile(join(tmp(), "missing-dir", "backup.json"), buildBackup(plan(), META), TARGET)).toThrow();
  });

  const tamper = (edit: (b: Record<string, any>) => void) => {
    const b = JSON.parse(JSON.stringify(buildBackup(plan(), META)));
    edit(b);
    return b;
  };

  it.each([
    ["a changed field state", (b: any) => (b.documents[0].original.isActive = { state: "present", value: false })],
    ["an added correction", (b: any) => (b.documents[6].set.isActive = true)],
    ["a removed document", (b: any) => b.documents.pop()],
    ["a changed run ID", (b: any) => (b.runId = "00000000-0000-4000-8000-000000000000")],
  ])("rejects %s (checksum mismatch)", (_label, edit) => {
    expect(() => validateBackup(tamper(edit), TARGET)).toThrow(BackupError);
  });

  it.each([
    ["another project", { ...TARGET, projectId: "demo-other" }],
    ["another emulator host", { ...TARGET, emulatorHost: "127.0.0.1:9090" }],
  ])("rejects a backup made for %s", (_label, target) => {
    expect(() => validateBackup(buildBackup(plan(), META), target)).toThrow(/project|host/);
  });

  it.each([
    ["another migration", (b: any) => (b.migration = "something-else")],
    ["another version", (b: any) => (b.version = 2)],
    ["a non-forum path", (b: any) => (b.documents[0].path = "users/x")],
    ["a correction for a field that wasn't missing", (b: any) => (b.documents[0].original.isActive = { state: "present", value: true })],
    ["a non-default value", (b: any) => (b.documents[0].set.isActive = false)],
    ["an unrelated field", (b: any) => (b.documents[0].set.title = "x")],
    ["a duplicate document", (b: any) => b.documents.push(b.documents[0])],
    ["a non-demo project", (b: any) => (b.projectId = "devtalk-88046")],
  ])("rejects %s even with a valid checksum", (_label, edit) => {
    // Re-sign the tampered body so only the structural checks can catch it
    const { checksum: _old, ...body } = tamper(edit);
    const target = body.projectId === "devtalk-88046" ? { ...TARGET, projectId: "devtalk-88046" } : TARGET;
    expect(() => validateBackup({ ...body, checksum: checksumOf(body) }, target)).toThrow(BackupError);
  });

  it("rejects malformed JSON in a file", () => {
    const file = join(tmp(), "backup.json");
    writeFileSync(file, "{ not json");
    expect(() => readBackupFile(file, TARGET)).toThrow(BackupError);
  });
});
