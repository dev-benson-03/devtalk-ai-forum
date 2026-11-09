/**
 * The visibility-flag migration rehearsal against the Firestore emulator
 * (demo project, synthetic data, real Admin SDK transactions): planning,
 * verified backup, apply with version and flag preconditions, resume after a
 * lost acknowledgement, verification, and rollback with commit-time
 * ownership. Expected counts are for the synthetic fixture only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { auditLegacyData } from "../../scripts/legacy-audit/audit";
import { assertSafeEmulatorTarget } from "../../scripts/legacy-audit/sources";
import { buildBackup, writeBackupFile, type Backup } from "../../scripts/visibility-rehearsal/artifacts";
import { openEmulatorStore, type EmulatorStore } from "../../scripts/visibility-rehearsal/emulator";
import { planVisibilityDefaults } from "../../scripts/visibility-rehearsal/plan";
import { applyBackup, readForumVisibility, rollbackBackup, verifyRun } from "../../scripts/visibility-rehearsal/rehearsal";
import { PROJECT_ID, startRulesEnv } from "./setup";

const DIR = join(__dirname, "..", "..", "scripts", "visibility-rehearsal");
const FIXTURE = JSON.parse(readFileSync(join(DIR, "fixtures", "visibility-sample.json"), "utf8")).forums as Record<string, Record<string, unknown>>;
const RUN_ID = "8a6e0f0e-1b2c-4d3e-8f40-5a6b7c8d9e0f";

let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
let store: EmulatorStore;

beforeAll(async () => {
  env = await startRulesEnv();
  app = initializeApp({ projectId: PROJECT_ID }, "visibility-rehearsal-seed");
  admin = getFirestore(app);
  store = await openEmulatorStore(PROJECT_ID, assertSafeEmulatorTarget);
});
afterAll(async () => {
  await store.close();
  await admin.terminate();
  await deleteApp(app);
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  const batch = admin.batch();
  for (const [id, data] of Object.entries(FIXTURE)) batch.set(admin.collection("forums").doc(id), data);
  await batch.commit();
});

const target = () => ({ projectId: PROJECT_ID, emulatorHost: process.env.FIRESTORE_EMULATOR_HOST! });
const forum = (id: string) => admin.collection("forums").doc(id);

async function planAndBackup(): Promise<Backup> {
  const observed = await readForumVisibility(store);
  const plan = planVisibilityDefaults(observed, auditLegacyData({ forums: observed, comments: [] }));
  const file = join(mkdtempSync(join(tmpdir(), "visibility-")), "backup.json");
  return writeBackupFile(file, buildBackup(plan, { ...target(), runId: RUN_ID, createdAt: new Date(0).toISOString() }), target());
}

/** Edits made by "someone else" between planning and apply. */
async function editAfterPlan() {
  await forum("v-changed-after-plan").update({ isActive: false });
  await forum("v-restored-after-plan").update({ isActive: false });
  await forum("v-restored-after-plan").update({ isActive: FieldValue.delete() }); // flags match the plan again
  await forum("v-deleted-after-plan").delete();
}

/** Edits made after the correction, before rollback. */
async function editAfterApply() {
  await forum("v-changed-after-apply").update({ isActive: false });
  await forum("v-changed-after-apply").update({ isActive: true }); // back to the value the migration wrote
  await forum("v-deleted-after-apply").delete();
}

/** Every forum and progress record, with data and update time. */
async function snapshotAll() {
  const out: Record<string, { data: unknown; updateTime: string }> = {};
  const add = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
    (out[d.ref.path] = { data: d.data(), updateTime: `${d.updateTime.seconds}.${d.updateTime.nanoseconds}` });
  (await admin.collection("forums").get()).docs.forEach(add);
  (await admin.collectionGroup("documents").get()).docs.forEach(add);
  return out;
}

const APPLIED = ["forums/v-active-missing", "forums/v-both-missing", "forums/v-changed-after-apply", "forums/v-deleted-after-apply", "forums/v-deleted-missing"];
const SKIPPED = [
  { path: "forums/v-changed-after-plan", reason: "changed_since_plan" },
  { path: "forums/v-deleted-after-plan", reason: "deleted" },
  { path: "forums/v-restored-after-plan", reason: "changed_since_plan" },
];

describe("planning on the emulator", () => {
  it("plans 8 documents and 13 fields out of 12, with 3 manual-review items and no content", async () => {
    const observed = await readForumVisibility(store);
    const plan = planVisibilityDefaults(observed, auditLegacyData({ forums: observed, comments: [] }));
    expect(plan.inspected).toBe(12);
    expect(plan.documents).toHaveLength(8);
    expect(plan.documents.reduce((n, d) => n + Object.keys(d.set).length, 0)).toBe(13);
    expect(plan.manualReview).toHaveLength(3);
    expect(JSON.stringify(plan)).not.toContain("PRIVATE");
    expect(plan.documents[0].updateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/);
  });
});

describe("apply", () => {
  it("adds only the missing flags, skips documents changed or deleted since planning, and touches nothing else", async () => {
    const backup = await planAndBackup();
    await editAfterPlan();
    const before = await snapshotAll();
    const report = await applyBackup(store, backup);
    expect(report).toMatchObject({ planned: 8, applied: APPLIED, fieldsWritten: 8, alreadyApplied: [], skipped: SKIPPED });

    const after = await snapshotAll();
    for (const [path, entry] of Object.entries(before)) {
      const doc = backup.documents.find((d) => d.path === path);
      if (doc && APPLIED.includes(path)) {
        expect(after[path].data).toEqual({ ...(entry.data as object), ...doc.set });
      } else {
        expect(after[path]).toEqual(entry); // explicit, null, invalid and skipped documents unchanged
      }
    }
    expect((await forum("v-null").get()).data()).toEqual(FIXTURE["v-null"]);
    expect((await forum("v-invalid").get()).data()).toEqual(FIXTURE["v-invalid"]);
    expect((await forum("v-changed-after-plan").get()).get("isActive")).toBe(false); // not overwritten
    expect((await forum("v-deleted-after-plan").get()).exists).toBe(false);
  });

  it("records a server commit-time marker that equals the forum's resulting update time", async () => {
    const backup = await planAndBackup();
    await applyBackup(store, backup);
    for (const path of APPLIED) {
      const record = await admin.doc(`visibilityRehearsalRuns/${RUN_ID}/documents/${path.slice(7)}`).get();
      expect(record.createTime!.isEqual((await admin.doc(path).get()).updateTime!)).toBe(true);
      expect(record.data()).toMatchObject({ migration: "forum-visibility-defaults-v1", runId: RUN_ID, path, backupDigest: backup.checksum, state: "applied" });
      expect(JSON.stringify(record.data())).not.toContain("PRIVATE");
    }
  });

  it("uses the record's createTime, not a serverTimestamp() field, as the commit marker", async () => {
    await admin.runTransaction(async (tx) => {
      tx.update(forum("v-both-missing"), { probe: 1 });
      tx.set(admin.doc("probe/marker"), { at: FieldValue.serverTimestamp() });
    });
    const [f, m] = await Promise.all([forum("v-both-missing").get(), admin.doc("probe/marker").get()]);
    expect(m.createTime!.isEqual(f.updateTime!)).toBe(true);
    // The field is resolved to whole milliseconds, while commit times carry
    // microseconds, so it can't serve as an exact commit marker
    expect(m.get("at").nanoseconds % 1_000_000).toBe(0);
  });

  it("makes zero writes on a second apply", async () => {
    const backup = await planAndBackup();
    await editAfterPlan();
    await applyBackup(store, backup);
    const before = await snapshotAll();
    const report = await applyBackup(store, backup);
    expect(report).toMatchObject({ applied: [], fieldsWritten: 0, alreadyApplied: APPLIED, skipped: SKIPPED });
    expect(await snapshotAll()).toEqual(before);
  });

  it("resumes after a lost acknowledgement without repeating committed work", async () => {
    const backup = await planAndBackup();
    await editAfterPlan();
    const lostAck = new Error("acknowledgement lost");
    let commits = 0;
    await expect(
      applyBackup(store, backup, {
        afterCommit: () => {
          if (++commits === 2) throw lostAck;
        },
      })
    ).rejects.toBe(lostAck);

    const partial = await verifyRun(store, backup);
    expect(partial.counts).toEqual({ applied: 2, pending: 3, changed_since_plan: 2, deleted: 1 });

    const resumed = await applyBackup(store, backup);
    expect(resumed).toMatchObject({ applied: APPLIED.slice(2), alreadyApplied: APPLIED.slice(0, 2), skipped: SKIPPED });
    expect((await admin.collectionGroup("documents").get()).size).toBe(5); // one record per corrected document
    expect((await verifyRun(store, backup)).counts).toEqual({ applied: 5, changed_since_plan: 2, deleted: 1 });
  });

  it("does not treat a progress record from another backup as completed work", async () => {
    const backup = await planAndBackup();
    await admin.doc(`visibilityRehearsalRuns/${RUN_ID}/documents/v-both-missing`).set({
      migration: "forum-visibility-defaults-v1", runId: RUN_ID, path: "forums/v-both-missing", backupDigest: "0".repeat(64),
      set: { isActive: true, isAdminDeleted: false }, state: "applied",
    });
    const report = await applyBackup(store, backup);
    expect(report.skipped).toContainEqual({ path: "forums/v-both-missing", reason: "foreign_progress_record" });
    expect(report.alreadyApplied).not.toContain("forums/v-both-missing");
    expect((await forum("v-both-missing").get()).data()).toEqual(FIXTURE["v-both-missing"]);
  });
});

describe("rollback", () => {
  async function appliedRun() {
    const backup = await planAndBackup();
    await editAfterPlan();
    await applyBackup(store, backup);
    await editAfterApply();
    return backup;
  }

  it("restores missing fields only where the migration still owns the document", async () => {
    const backup = await appliedRun();
    const report = await rollbackBackup(store, backup);
    expect(report).toMatchObject({
      restored: ["forums/v-active-missing", "forums/v-both-missing", "forums/v-deleted-missing"],
      fieldsRestored: 4,
      alreadyRestored: [],
      notApplied: ["forums/v-changed-after-plan", "forums/v-deleted-after-plan", "forums/v-restored-after-plan"],
      conflicts: [
        { path: "forums/v-changed-after-apply", reason: "changed_after_apply" },
        { path: "forums/v-deleted-after-apply", reason: "deleted" },
      ],
    });
    for (const id of ["v-active-missing", "v-both-missing", "v-deleted-missing"]) {
      expect((await forum(id).get()).data()).toEqual(FIXTURE[id]); // missing again, everything else intact
    }
    // Changed then restored to the migrated value: not proof of ownership, so left alone
    expect((await forum("v-changed-after-apply").get()).data()).toEqual({ ...FIXTURE["v-changed-after-apply"], isActive: true, isAdminDeleted: false });
    expect((await forum("v-deleted-after-apply").get()).exists).toBe(false); // never recreated
    expect((await verifyRun(store, backup)).counts).toEqual({ restored: 3, changed_after_apply: 1, deleted: 2, changed_since_plan: 2 });
  });

  it("is safe to repeat: restored documents stay restored and conflicts stay conflicts", async () => {
    const backup = await appliedRun();
    await rollbackBackup(store, backup);
    const before = await snapshotAll();
    const again = await rollbackBackup(store, backup);
    expect(again).toMatchObject({
      restored: [],
      fieldsRestored: 0,
      alreadyRestored: ["forums/v-active-missing", "forums/v-both-missing", "forums/v-deleted-missing"],
      conflicts: [
        { path: "forums/v-changed-after-apply", reason: "changed_after_apply" },
        { path: "forums/v-deleted-after-apply", reason: "deleted" },
      ],
    });
    expect(await snapshotAll()).toEqual(before);
  });

  it("records rollback completion atomically with the restore", async () => {
    const backup = await appliedRun();
    await rollbackBackup(store, backup);
    const record = await admin.doc(`visibilityRehearsalRuns/${RUN_ID}/documents/v-both-missing`).get();
    expect(record.get("state")).toBe("restored");
    expect(record.updateTime!.isEqual((await forum("v-both-missing").get()).updateTime!)).toBe(true);
  });

  it("is safe after a partial apply: only committed documents are restored", async () => {
    const backup = await planAndBackup();
    let commits = 0;
    await applyBackup(store, backup, { afterCommit: () => { if (++commits === 2) throw new Error("stop"); } }).catch(() => undefined);
    const report = await rollbackBackup(store, backup);
    expect(report.restored).toEqual(["forums/v-active-missing", "forums/v-both-missing"]);
    expect(report.notApplied).toHaveLength(6);
    for (const [id, data] of Object.entries(FIXTURE)) expect((await forum(id).get()).data()).toEqual(data);
  });
});

describe("end to end through the CLI", () => {
  const cli = (args: string[]) => {
    const result = spawnSync(process.execPath, [join(DIR, "cli.mjs"), ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? "" },
    });
    return { ...result, report: result.status === 0 ? JSON.parse(result.stdout) : undefined };
  };
  const ok = (args: string[]) => {
    const result = cli(args);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("PRIVATE");
    return result.report;
  };
  const missingFindings = () => {
    const audit = spawnSync(process.execPath, [join(DIR, "..", "legacy-audit", "cli.mjs"), "--emulator", "--project", PROJECT_ID], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? "" },
    });
    const { findings } = JSON.parse(audit.stdout);
    return [...findings.forum_is_active_missing, ...findings.forum_is_admin_deleted_missing].length;
  };

  it("plans, backs up, corrects, verifies, rolls back and verifies, with an idempotent second apply and rollback conflicts", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "visibility-e2e-")), "backup.json");
    const args = (command: string) => [command, "--project", PROJECT_ID, "--backup", file];
    expect(missingFindings()).toBe(13);

    expect(ok(args("plan"))).toMatchObject({ inspected: 12, plannedDocuments: 8, plannedFields: 13, backupVerified: true, writesPerformed: 0 });
    expect(readFileSync(file, "utf8")).not.toContain("PRIVATE");
    const replan = cli(args("plan"));
    expect(replan.status).toBe(2); // the backup is never overwritten
    expect(replan.stderr).toMatch(/already exists/);

    await editAfterPlan();
    expect(ok(args("apply"))).toMatchObject({ applied: APPLIED, fieldsWritten: 8, alreadyApplied: [], skipped: SKIPPED });
    expect(ok(args("verify")).counts).toEqual({ applied: 5, changed_since_plan: 2, deleted: 1 });
    expect(missingFindings()).toBe(3); // only the two documents skipped as changed since planning (1 + 2 fields)

    const before = await snapshotAll();
    expect(ok(args("apply"))).toMatchObject({ applied: [], fieldsWritten: 0, alreadyApplied: APPLIED });
    expect(await snapshotAll()).toEqual(before);

    await editAfterApply();
    expect(ok(args("rollback"))).toMatchObject({ fieldsRestored: 4, conflicts: [
      { path: "forums/v-changed-after-apply", reason: "changed_after_apply" },
      { path: "forums/v-deleted-after-apply", reason: "deleted" },
    ] });
    expect(ok(args("verify")).counts).toEqual({ restored: 3, changed_after_apply: 1, deleted: 2, changed_since_plan: 2 });
    expect(ok(args("rollback"))).toMatchObject({ restored: [], alreadyRestored: ["forums/v-active-missing", "forums/v-both-missing", "forums/v-deleted-missing"] });
  });

  it("refuses to apply with a tampered backup and writes nothing", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "visibility-e2e-")), "backup.json");
    ok(["plan", "--project", PROJECT_ID, "--backup", file]);
    const text = readFileSync(file, "utf8").replace('"isAdminDeleted": false', '"isAdminDeleted": true');
    require("node:fs").writeFileSync(file, text);
    const before = await snapshotAll();
    const result = cli(["apply", "--project", PROJECT_ID, "--backup", file]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Backup rejected/);
    expect(await snapshotAll()).toEqual(before);
  });
});
