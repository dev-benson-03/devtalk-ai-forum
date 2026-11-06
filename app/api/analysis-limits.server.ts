/**
 * Server-side abuse and cost protection for AI analysis, stored in Firestore
 * so every serverless instance shares it. Only the Admin SDK touches these
 * collections. All checks run in transactions; none is held open while
 * OpenAI is called.
 *
 *   analysisRateLimits/{uid}   requests + generations windows per verified UID
 *   analysisState/{forumId}    generation lock, cooldown, per-forum window
 *
 * Any Firestore failure here throws LimitStoreError and the route refuses the
 * request (fail closed); it never falls back to unlimited generation.
 */
import { randomUUID } from "crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Starting quotas for a small app. Change the numbers here to adjust. */
export const ANALYSIS_QUOTAS = {
  /** Every analysis request (cached or not) per user. */
  userRequests: { max: 20, windowMs: 10 * MINUTE },
  /** OpenAI generations started per user. */
  userGenerations: { max: 10, windowMs: DAY },
  /** OpenAI generations started per forum. */
  forumGenerations: { max: 24, windowMs: DAY },
  /** Minimum gap between successful generations for one forum. */
  forumCooldownMs: 10 * MINUTE,
  /** A lock older than this is stale (crashed or timed-out request) and can be taken over. */
  lockTtlMs: 2 * MINUTE,
  /** What clients are told to wait while another request generates. */
  inProgressRetryMs: 3_000,
} as const;

export const RATE_LIMIT_COLLECTION = "analysisRateLimits";
export const STATE_COLLECTION = "analysisState";

export class LimitStoreError extends Error {
  constructor(readonly cause: unknown) {
    super("Rate-limit storage unavailable");
    this.name = "LimitStoreError";
  }
}

interface Quota {
  max: number;
  windowMs: number;
}
interface Window {
  start: Timestamp;
  count: number;
}

const ms = (value: unknown): number => {
  const toMillis = (value as { toMillis?: unknown } | null)?.toMillis;
  return typeof toMillis === "function" ? Number(toMillis.call(value)) || 0 : 0;
};

/** Fixed window: resets after windowMs, otherwise counts up to max. */
function take(current: unknown, quota: Quota, now: number): { next: Window } | { retryAfterMs: number } {
  const start = ms((current as { start?: unknown } | null)?.start);
  const count = Number((current as { count?: unknown } | null)?.count) || 0;
  if (!start || now - start >= quota.windowMs) return { next: { start: Timestamp.fromMillis(now), count: 1 } };
  if (count >= quota.max) return { retryAfterMs: start + quota.windowMs - now };
  return { next: { start: Timestamp.fromMillis(start), count: count + 1 } };
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new LimitStoreError(error);
  }
}

export type Limited = { ok: false; scope: string; retryAfterMs: number };

/** Counts one analysis request for this user, before any forum data is read. */
export function consumeUserRequest(db: Firestore, uid: string, now = Date.now()): Promise<{ ok: true } | Limited> {
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(uid);
  return guarded(() =>
    db.runTransaction(async (tx) => {
      const result = take((await tx.get(ref)).data()?.requests, ANALYSIS_QUOTAS.userRequests, now);
      if ("retryAfterMs" in result) return { ok: false as const, scope: "user_requests", ...result };
      tx.set(ref, { requests: result.next, expireAt: Timestamp.fromMillis(now + DAY) }, { merge: true });
      return { ok: true as const };
    })
  );
}

export type GenerationGate =
  | { kind: "acquired"; holder: string; recoveredStaleLock: boolean }
  | { kind: "in_progress"; retryAfterMs: number }
  | { kind: "cooldown"; retryAfterMs: number; previousKey: string | null }
  | ({ kind: "limited" } & Omit<Limited, "ok">);

/**
 * Atomically decides whether this request may call OpenAI for `key`, and if
 * so takes the forum's generation lock and counts the attempt against the
 * forum and user quotas. Attempts count even if they later fail, so failures
 * can't be retried without limit.
 */
export function acquireGeneration(
  db: Firestore,
  { forumId, uid, key }: { forumId: string; uid: string; key: string },
  now = Date.now()
): Promise<GenerationGate> {
  const stateRef = db.collection(STATE_COLLECTION).doc(forumId);
  const userRef = db.collection(RATE_LIMIT_COLLECTION).doc(uid);
  const Q = ANALYSIS_QUOTAS;
  return guarded(() =>
    db.runTransaction(async (tx): Promise<GenerationGate> => {
      const state = (await tx.get(stateRef)).data() ?? {};
      const user = (await tx.get(userRef)).data() ?? {};

      const lockExpires = ms(state.lock?.expiresAt);
      if (lockExpires > now) return { kind: "in_progress", retryAfterMs: Q.inProgressRetryMs };

      const last = ms(state.lastGeneratedAt);
      if (last && now - last < Q.forumCooldownMs) {
        const previousKey = typeof state.lastKey === "string" ? state.lastKey : null;
        return { kind: "cooldown", retryAfterMs: last + Q.forumCooldownMs - now, previousKey };
      }

      const forum = take(state.generations, Q.forumGenerations, now);
      if ("retryAfterMs" in forum) return { kind: "limited", scope: "forum_generations", ...forum };
      const mine = take(user.generations, Q.userGenerations, now);
      if ("retryAfterMs" in mine) return { kind: "limited", scope: "user_generations", ...mine };

      const holder = randomUUID();
      const lock = { holder, key, expiresAt: Timestamp.fromMillis(now + Q.lockTtlMs) };
      tx.set(stateRef, { forumId, lock, generations: forum.next }, { merge: true });
      tx.set(userRef, { generations: mine.next, expireAt: Timestamp.fromMillis(now + DAY) }, { merge: true });
      return { kind: "acquired", holder, recoveredStaleLock: lockExpires > 0 };
    })
  );
}

/**
 * Releases the lock if this request still holds it. On success also records
 * the generation time (starts the cooldown) and the key of the latest valid
 * analysis, which is served during the cooldown.
 */
export function finishGeneration(
  db: Firestore,
  { forumId, holder, key, succeeded }: { forumId: string; holder: string; key: string; succeeded: boolean },
  now = Date.now()
): Promise<void> {
  const stateRef = db.collection(STATE_COLLECTION).doc(forumId);
  return guarded(() =>
    db.runTransaction(async (tx) => {
      const state = (await tx.get(stateRef)).data() ?? {};
      const update: Record<string, unknown> = {};
      if (state.lock?.holder === holder) update.lock = null;
      if (succeeded && now >= ms(state.lastGeneratedAt)) {
        update.lastGeneratedAt = Timestamp.fromMillis(now);
        update.lastKey = key;
      }
      if (Object.keys(update).length > 0) tx.set(stateRef, update, { merge: true });
    })
  );
}
