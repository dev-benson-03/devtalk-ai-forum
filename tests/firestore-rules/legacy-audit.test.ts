/**
 * The legacy-data audit against the Firestore emulator (demo project): the
 * emulator adapter reads only the audited fields, the report matches the
 * fixture-based one exactly, and an audit changes nothing in the database
 * (same data and same update times before and after). Synthetic data only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { auditLegacyData } from "../../scripts/legacy-audit/audit";
import { fixtureToInput, readEmulator } from "../../scripts/legacy-audit/sources";
import { PROJECT_ID, startRulesEnv } from "./setup";

const SCRIPTS = join(__dirname, "..", "..", "scripts", "legacy-audit");
const FIXTURE = JSON.parse(readFileSync(join(SCRIPTS, "fixtures", "legacy-sample.json"), "utf8"));

let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;

beforeAll(async () => {
  env = await startRulesEnv();
  app = initializeApp({ projectId: PROJECT_ID }, "legacy-audit-seed");
  admin = getFirestore(app);
});
afterAll(async () => {
  await admin.terminate();
  await deleteApp(app);
  await env.cleanup();
});

/** Fixture { "$timestamp": ISO } values become real Firestore Timestamps. */
const revive = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) =>
      v && typeof v === "object" && "$timestamp" in v ? [k, Timestamp.fromMillis(Date.parse((v as { $timestamp: string }).$timestamp))] : [k, v]
    )
  );

beforeEach(async () => {
  await env.clearFirestore();
  const batch = admin.batch();
  for (const collection of ["forums", "comments"] as const) {
    for (const [id, data] of Object.entries(FIXTURE[collection] as Record<string, Record<string, unknown>>)) {
      batch.set(admin.collection(collection).doc(id), revive(data));
    }
  }
  batch.set(admin.collection("analysisCache").doc("f-ok_abc"), { summary: "untouched" });
  await batch.commit();
});

/** Every document's path, data and update time, to prove nothing changed. */
async function snapshotAll() {
  const out: Record<string, { data: unknown; updateTime: string }> = {};
  for (const collection of await admin.listCollections()) {
    for (const doc of (await collection.get()).docs) {
      out[doc.ref.path] = { data: doc.data(), updateTime: doc.updateTime.toDate().toISOString() };
    }
  }
  return out;
}

describe("legacy-data audit on the emulator", () => {
  it("reads only the audited fields", async () => {
    const input = await readEmulator(PROJECT_ID);
    const fieldNames = new Set([...input.forums, ...input.comments].flatMap((d) => Object.keys(d.fields)));
    expect([...fieldNames].sort()).toEqual(["commentCount", "endTime", "forumId", "isActive", "isAdminDeleted", "moderationPolicy"]);
    expect(JSON.stringify(input)).not.toContain("PRIVATE");
  });

  it("produces the same report as the fixture, and writes nothing", async () => {
    const before = await snapshotAll();
    const fromEmulator = auditLegacyData(await readEmulator(PROJECT_ID));
    const fromFixture = auditLegacyData(fixtureToInput(FIXTURE));
    expect(fromEmulator).toEqual(fromFixture);
    expect(fromEmulator.writesPerformed).toBe(0);
    expect(await snapshotAll()).toEqual(before);
  });

  it("runs end to end through the CLI against the emulator without writing", async () => {
    const before = await snapshotAll();
    const result = spawnSync(process.execPath, [join(SCRIPTS, "cli.mjs"), "--emulator", "--project", PROJECT_ID], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? "" },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.source).toEqual({ kind: "emulator", host: process.env.FIRESTORE_EMULATOR_HOST, projectId: PROJECT_ID });
    expect(report.affectedDocuments).toEqual({ forums: 8, comments: 5, total: 13 });
    expect(result.stdout).not.toContain("PRIVATE");
    expect(await snapshotAll()).toEqual(before);
  });

  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])("keeps a stored %s commentCount exact in the CLI's JSON report", async (tag, value) => {
    await admin.collection("forums").doc("f-ok").update({ commentCount: value });
    const result = spawnSync(process.execPath, [join(SCRIPTS, "cli.mjs"), "--emulator", "--project", PROJECT_ID], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? "" },
    });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    const correction = report.proposedCorrections.find((c: { path: string }) => c.path === "forums/f-ok");
    expect(correction.reasons).toEqual(["forum_comment_count_invalid"]);
    // Not null, which is what JSON.stringify makes of a raw NaN or Infinity
    expect(correction.expect).toEqual({ commentCount: { type: "number", value: { $number: tag } } });
  });
});
