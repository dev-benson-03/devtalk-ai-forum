/**
 * Applies, verifies and removes the synthetic staging seed (dataset.ts).
 *
 *   apply    preflight first: any planned document that exists without this
 *            seed's marker, or any planned account whose uid or email is
 *            taken by something else, stops the run before a single write.
 *            The seed record (stagingSeed/staging-seed-v1) is written next,
 *            listing everything this seed may own, then missing accounts and
 *            documents are created with create(), never overwritten.
 *            Re-running skips what exists, so apply is idempotent.
 *   verify   read-only: what is present, missing or foreign.
 *   cleanup  deletes only documents that still carry this seed's marker and
 *            accounts whose uid and email both match the plan, then the record.
 *
 * New accounts get random passwords, returned to the caller (the CLI writes
 * them to a private file). Existing accounts keep theirs. No custom claims.
 *
 * Type-only Firebase imports: the caller passes the Admin handles, so Node
 * runs this file as is and tests can drive it against the emulators.
 */
import { randomBytes } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import type { SeedPlan, SeedValue } from "./dataset";

/** The Admin Auth calls the seed uses (firebase-admin's Auth satisfies it). */
export type SeedAuth = Pick<Auth, "getUser" | "getUserByEmail" | "createUser" | "deleteUser">;

export interface SeedHandles {
  db: Firestore;
  auth: SeedAuth;
  timestampFromMillis: (ms: number) => Timestamp;
  /** Throws if the target changed since validation; called before every operation. */
  guard: () => void;
}

export interface SeedReport {
  documents: { created: number; existing: number };
  users: { created: number; existing: number };
  /** Passwords for accounts created in this run only. Never logged. */
  newCredentials: { email: string; password: string }[];
}

export class SeedConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConflict";
  }
}

const isTimestampMarker = (value: unknown): value is { $timestamp: number } =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && "$timestamp" in value;

function materialize(value: SeedValue, h: SeedHandles): unknown {
  if (Array.isArray(value)) return value.map((v) => materialize(v, h));
  if (isTimestampMarker(value)) return h.timestampFromMillis(value.$timestamp);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, materialize(v, h)]));
  }
  return value;
}

const errorCode = (error: unknown) => (error as { code?: unknown })?.code;
const isNotFound = (error: unknown) => errorCode(error) === "auth/user-not-found";

async function findUser(h: SeedHandles, uid: string) {
  h.guard();
  try {
    return await h.auth.getUser(uid);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function findUserByEmail(h: SeedHandles, email: string) {
  h.guard();
  try {
    return await h.auth.getUserByEmail(email);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

type DocState = "missing" | "seeded" | "foreign";
type UserState = "missing" | "seeded" | "foreign";

async function documentStates(plan: SeedPlan, h: SeedHandles): Promise<Map<string, DocState>> {
  const states = new Map<string, DocState>();
  for (const doc of plan.documents) {
    h.guard();
    const snap = await h.db.doc(doc.path).get();
    states.set(doc.path, !snap.exists ? "missing" : snap.get("seed") === plan.seed ? "seeded" : "foreign");
  }
  return states;
}

async function userStates(plan: SeedPlan, h: SeedHandles): Promise<Map<string, UserState>> {
  const states = new Map<string, UserState>();
  for (const user of plan.users) {
    const byUid = await findUser(h, user.uid);
    const byEmail = await findUserByEmail(h, user.email);
    if (!byUid && !byEmail) states.set(user.uid, "missing");
    else if (byUid && byEmail && byUid.uid === byEmail.uid) states.set(user.uid, "seeded");
    else states.set(user.uid, "foreign");
  }
  return states;
}

/** Read-only status of every planned account and document. */
export async function verifySeed(plan: SeedPlan, h: SeedHandles) {
  const docs = await documentStates(plan, h);
  const users = await userStates(plan, h);
  h.guard();
  const record = await h.db.doc(recordPath(plan)).get();
  const tally = (states: Map<string, string>) => {
    const counts = { missing: 0, seeded: 0, foreign: 0 };
    for (const state of states.values()) counts[state as keyof typeof counts]++;
    return counts;
  };
  return {
    record: record.exists ? (record.get("status") as string) : "absent",
    documents: tally(docs),
    users: tally(users),
    foreign: [...docs].filter(([, s]) => s === "foreign").map(([p]) => p).concat([...users].filter(([, s]) => s === "foreign").map(([u]) => `auth/${u}`)),
  };
}

const recordPath = (plan: SeedPlan) => `stagingSeed/${plan.seed}`;

export async function applySeed(plan: SeedPlan, h: SeedHandles, makePassword = () => randomBytes(18).toString("base64url")): Promise<SeedReport> {
  // 1. Preflight: refuse before any write if anything planned belongs to someone else
  const docs = await documentStates(plan, h);
  const users = await userStates(plan, h);
  const foreign = [...docs].filter(([, s]) => s === "foreign").map(([p]) => p)
    .concat([...users].filter(([, s]) => s === "foreign").map(([u]) => `auth/${u}`));
  if (foreign.length > 0) throw new SeedConflict(`planned records exist without this seed's marker: ${foreign.join(", ")}`);

  // 2. Record what this seed may own, before creating it
  h.guard();
  await h.db.doc(recordPath(plan)).set(
    {
      seed: plan.seed,
      status: "applying",
      paths: plan.documents.map((d) => d.path),
      userUids: plan.users.map((u) => u.uid),
      userEmails: plan.users.map((u) => u.email),
      updatedAt: h.timestampFromMillis(Date.now()),
    },
    { merge: true }
  );

  // 3. Accounts: create missing ones, never modify existing ones, no claims
  const report: SeedReport = { documents: { created: 0, existing: 0 }, users: { created: 0, existing: 0 }, newCredentials: [] };
  for (const user of plan.users) {
    if (users.get(user.uid) === "seeded") {
      report.users.existing++;
      continue;
    }
    const password = makePassword();
    h.guard();
    await h.auth.createUser({ uid: user.uid, email: user.email, displayName: user.displayName, password, emailVerified: false });
    report.users.created++;
    report.newCredentials.push({ email: user.email, password });
  }

  // 4. Documents: create() fails rather than overwrite something written meanwhile
  for (const doc of plan.documents) {
    if (docs.get(doc.path) === "seeded") {
      report.documents.existing++;
      continue;
    }
    h.guard();
    await h.db.doc(doc.path).create(materialize(doc.data, h) as Record<string, unknown>);
    report.documents.created++;
  }

  h.guard();
  await h.db.doc(recordPath(plan)).update({ status: "applied", updatedAt: h.timestampFromMillis(Date.now()) });
  return report;
}

/** Removes only what this seed owns: marked documents and matching accounts. */
export async function cleanupSeed(plan: SeedPlan, h: SeedHandles) {
  h.guard();
  const record = await h.db.doc(recordPath(plan)).get();
  const paths: string[] = record.exists ? (record.get("paths") as string[]) : plan.documents.map((d) => d.path);
  const removed = { documents: 0, users: 0, skipped: [] as string[] };

  for (const path of paths) {
    h.guard();
    const ref = h.db.doc(path);
    const deleted = await h.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      if (snap.get("seed") !== plan.seed) {
        removed.skipped.push(path);
        return false;
      }
      tx.delete(ref);
      return true;
    });
    if (deleted) removed.documents++;
  }

  for (const user of plan.users) {
    const existing = await findUser(h, user.uid);
    if (!existing) continue;
    if (existing.email !== user.email) {
      removed.skipped.push(`auth/${user.uid}`);
      continue;
    }
    h.guard();
    await h.auth.deleteUser(user.uid);
    removed.users++;
  }

  if (removed.skipped.length === 0) {
    h.guard();
    await h.db.doc(recordPath(plan)).delete();
  }
  return removed;
}
