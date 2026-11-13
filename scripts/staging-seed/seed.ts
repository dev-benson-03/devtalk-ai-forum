/**
 * Applies, verifies and removes the synthetic staging seed (dataset.ts).
 *
 * Ownership. The seed record (stagingSeed/staging-seed-v1) is the ledger. It
 * names the seed, the target and a digest of the plan, and for each account
 * the seed created: its email, the id of the credentials file that holds its
 * password, and "pending" (written before createUser) or "created" plus the
 * account's creationTime (written after). An account is
 * the seed's only when its uid and email match the plan AND its ledger entry
 * is "created" with the same creationTime. A matching account with no entry,
 * or with another creationTime (deleted and recreated), belongs to someone
 * else. A "pending" entry for an existing account is uncertain: createUser
 * may have succeeded without the seed confirming it. Foreign and uncertain
 * accounts are never adopted, changed or deleted.
 *
 *   apply    preflight: a ledger for another seed, target or plan, a planned
 *            document without this seed's marker, or a foreign or uncertain
 *            account stops the run before any write. Then missing accounts
 *            (password from the credential store, saved before createUser)
 *            and documents are created, never overwritten. Re-running with
 *            the same credential store resumes an interrupted run.
 *   verify   read-only: what is present, missing, foreign or uncertain.
 *   cleanup  deletes only planned documents that carry this seed's marker
 *            and planned accounts the ledger proves the seed created, then
 *            the ledger once nothing was skipped.
 *
 * Limits (Firebase Auth and Firestore share no transaction):
 *   - Between createUser succeeding and the ledger confirming it, a failure
 *     leaves a "pending" entry; the account is then uncertain until a person
 *     resolves it (see docs/architecture/staging.md).
 *   - The Admin SDK reports creationTime to the second, so an account deleted
 *     and recreated with the same uid and email within the same second as the
 *     seed's creation is indistinguishable.
 *   - Auth has no conditional delete: an account replaced between cleanup's
 *     check and its deleteUser call would be deleted. The window is one
 *     request long.
 *
 * Passwords never reach Firestore, logs or errors. No custom claims.
 * Type-only Firebase imports: the caller passes the Admin handles, so Node
 * runs this file as is and tests can drive it against the emulators.
 */
import { createHash } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import type { SeedPlan, SeedUser, SeedValue } from "./dataset";

/** The Admin Auth calls the seed uses (firebase-admin's Auth satisfies it). */
export type SeedAuth = Pick<Auth, "getUser" | "getUserByEmail" | "createUser" | "deleteUser">;

export interface SeedTargetInfo {
  kind: string;
  projectId: string;
}

export interface SeedHandles {
  db: Firestore;
  auth: SeedAuth;
  timestampFromMillis: (ms: number) => Timestamp;
  /** Throws if the target changed since validation; called before every operation. */
  guard: () => void;
  /** The validated target; recorded in, and checked against, the ledger. */
  target: SeedTargetInfo;
}

/** Where apply gets each new account's password (credentials.ts). */
export interface CredentialStore {
  /** Identifies the credentials file; recorded in each ledger entry so recovery knows which file holds the password. */
  readonly id: string;
  /** The password recorded for this account, or a new one saved durably before it is returned. */
  passwordFor(user: SeedUser): string;
  /** Records that the account was created and the ledger confirmed it. Idempotent. */
  markCreated(uid: string): void;
}

export interface SeedReport {
  documents: { created: number; existing: number };
  users: { created: number; existing: number };
  /** Accounts created in this run. Passwords stay in the credential store. */
  createdUids: string[];
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

/** Identifies the plan (seed, accounts, paths), so a ledger or credentials file from another plan is rejected. */
export function planDigest(plan: SeedPlan): string {
  const identity = { seed: plan.seed, users: plan.users.map((u) => [u.uid, u.email]), paths: plan.documents.map((d) => d.path) };
  return createHash("sha256").update(JSON.stringify(identity), "utf8").digest("hex");
}

const errorCode = (error: unknown) => (error as { code?: unknown })?.code;
const isNotFound = (error: unknown) => errorCode(error) === "auth/user-not-found";
const creationTimeOf = (user: unknown) => (user as { metadata?: { creationTime?: unknown } } | null)?.metadata?.creationTime;

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

// ---- Ledger -------------------------------------------------------------

/** credentialsId names the credentials file that holds the account's password (never the password itself). */
type AccountEntry =
  | { email: string; credentialsId: string; state: "pending" }
  | { email: string; credentialsId: string; state: "created"; creationTime: string };
type Ledger = { state: "absent" } | { state: "valid"; accounts: Record<string, AccountEntry> } | { state: "invalid"; reason: string };

const recordPath = (plan: SeedPlan) => `stagingSeed/${plan.seed}`;

function parseAccounts(plan: SeedPlan, raw: unknown): Record<string, AccountEntry> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const planned = new Map(plan.users.map((u) => [u.uid, u.email]));
  const accounts: Record<string, AccountEntry> = {};
  for (const [uid, value] of Object.entries(raw)) {
    const entry = value as Partial<{ email: unknown; credentialsId: unknown; state: unknown; creationTime: unknown }>;
    if (planned.get(uid) === undefined || entry?.email !== planned.get(uid)) return null;
    const { email, credentialsId } = entry;
    if (typeof email !== "string" || typeof credentialsId !== "string" || !credentialsId) return null;
    if (entry.state === "pending") accounts[uid] = { email, credentialsId, state: "pending" };
    else if (entry.state === "created" && typeof entry.creationTime === "string" && entry.creationTime) {
      accounts[uid] = { email, credentialsId, state: "created", creationTime: entry.creationTime };
    } else return null;
  }
  return accounts;
}

/** The ledger, validated against this plan and target. Unknown fields or values make it invalid, never trusted. */
function interpretLedger(plan: SeedPlan, h: SeedHandles, data: Record<string, unknown> | undefined): Ledger {
  if (!data) return { state: "absent" };
  const target = data.target as Partial<SeedTargetInfo> | undefined;
  if (data.seed !== plan.seed) return { state: "invalid", reason: "it names another seed" };
  if (target?.kind !== h.target.kind || target?.projectId !== h.target.projectId) return { state: "invalid", reason: "it names another target" };
  if (data.planDigest !== planDigest(plan)) return { state: "invalid", reason: "it was written for another plan" };
  const accounts = parseAccounts(plan, data.accounts ?? {});
  if (!accounts) return { state: "invalid", reason: "its account entries do not match the plan" };
  return { state: "valid", accounts };
}

async function readLedger(plan: SeedPlan, h: SeedHandles): Promise<Ledger> {
  h.guard();
  const snap = await h.db.doc(recordPath(plan)).get();
  return interpretLedger(plan, h, snap.exists ? snap.data() : undefined);
}

/**
 * Sets one account's entry, re-validating the ledger in the same
 * transaction. Only two transitions are allowed, both for this credentials
 * file: (none, or any entry of this file) -> pending, made only for a missing
 * account, and this file's pending -> created. Anything
 * else means another apply (with another credentials file) is working on the
 * same account, and this run stops.
 */
async function setAccountEntry(plan: SeedPlan, h: SeedHandles, uid: string, entry: AccountEntry) {
  h.guard();
  const ref = h.db.doc(recordPath(plan));
  await h.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const ledger = interpretLedger(plan, h, snap.exists ? snap.data() : undefined);
    if (ledger.state !== "valid") throw new SeedConflict(`the seed record changed during apply (${ledger.state})`);
    const current = ledger.accounts[uid];
    const ownPending = current?.state === "pending" && current.credentialsId === entry.credentialsId;
    const allowed = entry.state === "pending" ? !current || current.credentialsId === entry.credentialsId : ownPending;
    if (!allowed) throw new SeedConflict(`auth/${uid}'s ledger entry was changed by another apply; stopping`);
    tx.update(ref, { accounts: { ...ledger.accounts, [uid]: entry }, updatedAt: h.timestampFromMillis(Date.now()) });
  });
}

// ---- State --------------------------------------------------------------

type DocState = "missing" | "seeded" | "foreign";
type UserState = "missing" | "seeded" | "foreign" | "uncertain";

async function documentStates(plan: SeedPlan, h: SeedHandles): Promise<Map<string, DocState>> {
  const states = new Map<string, DocState>();
  for (const doc of plan.documents) {
    h.guard();
    const snap = await h.db.doc(doc.path).get();
    states.set(doc.path, !snap.exists ? "missing" : snap.get("seed") === plan.seed ? "seeded" : "foreign");
  }
  return states;
}

async function userState(user: SeedUser, h: SeedHandles, ledger: Ledger): Promise<UserState> {
  const byUid = await findUser(h, user.uid);
  const byEmail = await findUserByEmail(h, user.email);
  if (!byUid && !byEmail) return "missing";
  if (!byUid || !byEmail || byUid.uid !== byEmail.uid) return "foreign";
  const entry = ledger.state === "valid" ? ledger.accounts[user.uid] : undefined;
  if (entry?.state === "created" && entry.creationTime === creationTimeOf(byUid)) return "seeded";
  if (entry?.state === "pending") return "uncertain";
  return "foreign";
}

async function userStates(plan: SeedPlan, h: SeedHandles, ledger: Ledger): Promise<Map<string, UserState>> {
  const states = new Map<string, UserState>();
  for (const user of plan.users) states.set(user.uid, await userState(user, h, ledger));
  return states;
}

const named = <S>(states: Map<string, S>, state: S, prefix = "") => [...states].filter(([, s]) => s === state).map(([k]) => `${prefix}${k}`);

/** Read-only status of every planned account and document. */
export async function verifySeed(plan: SeedPlan, h: SeedHandles) {
  const ledger = await readLedger(plan, h);
  const docs = await documentStates(plan, h);
  const users = await userStates(plan, h, ledger);
  const tally = <S extends string>(states: Map<string, S>, keys: S[]) =>
    Object.fromEntries(keys.map((k) => [k, named(states, k).length])) as Record<S, number>;
  let record = ledger.state;
  if (ledger.state === "valid") {
    h.guard();
    record = (await h.db.doc(recordPath(plan)).get()).get("status");
  }
  return {
    record,
    documents: tally(docs, ["missing", "seeded", "foreign"]),
    users: tally(users, ["missing", "seeded", "foreign", "uncertain"]),
    foreign: named(docs, "foreign").concat(named(users, "foreign", "auth/")),
    uncertain: named(users, "uncertain", "auth/"),
  };
}

// ---- Apply --------------------------------------------------------------

export async function applySeed(plan: SeedPlan, h: SeedHandles, credentials: CredentialStore): Promise<SeedReport> {
  // 1. Preflight: refuse before any write unless everything planned is missing or provably this seed's
  const ledger = await readLedger(plan, h);
  if (ledger.state === "invalid") throw new SeedConflict(`the seed record ${recordPath(plan)} does not belong to this run: ${ledger.reason}`);
  const docs = await documentStates(plan, h);
  const users = await userStates(plan, h, ledger);
  const foreign = named(docs, "foreign").concat(named(users, "foreign", "auth/"));
  if (foreign.length > 0) throw new SeedConflict(`planned records exist that this seed cannot prove it created: ${foreign.join(", ")}`);
  // A pending entry for a missing account belongs to the run that wrote it: continue only with that credentials file
  const otherFile = plan.users
    .filter((u) => users.get(u.uid) === "missing" && ledger.state === "valid" && ledger.accounts[u.uid] && ledger.accounts[u.uid].credentialsId !== credentials.id)
    .map((u) => `auth/${u.uid}`);
  if (otherFile.length > 0) {
    throw new SeedConflict(
      `an earlier run saved passwords for ${otherFile.join(", ")} in another credentials file; ` +
        "resume with that file (--resume), or run cleanup first"
    );
  }
  const uncertain = named(users, "uncertain", "auth/");
  if (uncertain.length > 0) {
    throw new SeedConflict(
      `an earlier run may have created ${uncertain.join(", ")} without confirming it; left untouched. ` +
        "See 'Recovering an interrupted apply' in docs/architecture/staging.md."
    );
  }

  // 2. The ledger exists before any account or document does
  h.guard();
  const ref = h.db.doc(recordPath(plan));
  const now = () => h.timestampFromMillis(Date.now());
  if (ledger.state === "absent") {
    await ref.create({
      seed: plan.seed,
      target: { kind: h.target.kind, projectId: h.target.projectId },
      planDigest: planDigest(plan),
      status: "applying",
      paths: plan.documents.map((d) => d.path),
      accounts: {},
      updatedAt: now(),
    });
  } else {
    await ref.update({ status: "applying", updatedAt: now() });
  }

  // 3. Accounts: password saved, ledger "pending", createUser, ledger "created". Existing accounts are never modified.
  const report: SeedReport = { documents: { created: 0, existing: 0 }, users: { created: 0, existing: 0 }, createdUids: [] };
  for (const user of plan.users) {
    if (users.get(user.uid) === "seeded") {
      // An earlier run with this credentials file may have stopped between the ledger and the file
      const entry = ledger.state === "valid" ? ledger.accounts[user.uid] : undefined;
      if (entry?.credentialsId === credentials.id) credentials.markCreated(user.uid);
      report.users.existing++;
      continue;
    }
    const password = credentials.passwordFor(user);
    const credentialsId = credentials.id;
    await setAccountEntry(plan, h, user.uid, { email: user.email, credentialsId, state: "pending" });
    h.guard();
    const created = await h.auth.createUser({ uid: user.uid, email: user.email, displayName: user.displayName, password, emailVerified: false });
    const creationTime = creationTimeOf(created);
    if (typeof creationTime !== "string" || !creationTime) {
      throw new SeedConflict(`auth/${user.uid} was created but reported no creation time; its ownership stays pending`);
    }
    await setAccountEntry(plan, h, user.uid, { email: user.email, credentialsId, state: "created", creationTime });
    credentials.markCreated(user.uid);
    report.users.created++;
    report.createdUids.push(user.uid);
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
  await ref.update({ status: "applied", updatedAt: now() });
  return report;
}

// ---- Cleanup ------------------------------------------------------------

/**
 * Removes only what this seed provably owns: planned documents that carry its
 * marker, and planned accounts its ledger confirms it created. Never acts on
 * paths or accounts that only the ledger lists.
 */
export async function cleanupSeed(plan: SeedPlan, h: SeedHandles) {
  const ledger = await readLedger(plan, h);
  if (ledger.state === "invalid") throw new SeedConflict(`the seed record ${recordPath(plan)} does not belong to this run: ${ledger.reason}`);
  const removed = { documents: 0, users: 0, skipped: [] as string[] };

  for (const { path } of plan.documents) {
    h.guard();
    const ref = h.db.doc(path);
    // The callback may run more than once; only its final result counts
    const outcome = await h.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return "missing";
      if (snap.get("seed") !== plan.seed) return "foreign";
      tx.delete(ref);
      return "deleted";
    });
    if (outcome === "deleted") removed.documents++;
    if (outcome === "foreign") removed.skipped.push(path);
  }

  for (const user of plan.users) {
    const state = await userState(user, h, ledger);
    if (state === "missing") continue;
    if (state !== "seeded") {
      removed.skipped.push(`auth/${user.uid} (${state})`);
      continue;
    }
    h.guard();
    await h.auth.deleteUser(user.uid);
    removed.users++;
  }

  if (removed.skipped.length === 0 && ledger.state === "valid") {
    h.guard();
    await h.db.doc(recordPath(plan)).delete();
  }
  return removed;
}
