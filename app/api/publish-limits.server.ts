/**
 * Per-user admission control for publishing, stored in Firestore so every
 * server instance shares it (docs/architecture/publishing.md). Checked after
 * authentication and validation and before moderation; an admitted attempt
 * stays counted whatever happens next (rejection, provider failure, write
 * failure), so rejected content can't be resubmitted without limit.
 *
 *   publishRateLimits/{uid}  { forums, comments, daily: { start, count }, expireAt }
 *
 * Only the Admin SDK touches this collection (firestore.rules deny browsers).
 * Any Firestore failure throws PublishLimitStoreError: the caller refuses the
 * request (fail closed) and never treats it as "over the limit".
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Starting values for a small forum, not measured thresholds. Fixed windows:
 * each window starts at the first admitted attempt and resets after windowMs.
 */
export const PUBLISH_LIMITS = {
  /** New forums per user. */
  forums: { max: 5, windowMs: 60 * MINUTE },
  /** New comments per user. */
  comments: { max: 30, windowMs: 10 * MINUTE },
  /**
   * Forums and comments together per user per UTC calendar day: resets at
   * 00:00:00 UTC. Counts admitted attempts, not provider calls (the SDK may retry).
   */
  daily: { max: 200, windowMs: DAY, alignToUtcDay: true },
} as const;

export const PUBLISH_LIMIT_COLLECTION = "publishRateLimits";

export class PublishLimitStoreError extends Error {
  constructor(readonly cause: unknown) {
    super("Publishing limit storage unavailable");
    this.name = "PublishLimitStoreError";
  }
}

export type Admission = { ok: true } | { ok: false; retryAfterMs: number };

interface Window {
  start: Timestamp;
  count: number;
}

/**
 * 00:00:00.000 UTC of the day containing `ms`. Plain integer milliseconds
 * since 1970 (UTC, no time zones, daylight saving or two-digit years), so
 * year, month, leap-day and 2038 boundaries need no special cases.
 */
const utcDayStart = (ms: number) => ms - (((ms % DAY) + DAY) % DAY);

/**
 * Fixed window: a missing, malformed or expired window starts over. A start
 * slightly after `now` (another instance's clock, or a request that read the
 * clock a moment earlier) is still the current window; treating it as
 * expired would reset the count and admit too much.
 */
function take(
  current: unknown,
  quota: { max: number; windowMs: number; alignToUtcDay?: boolean },
  now: number
): Window | { retryAfterMs: number } {
  const { start, count } = (current ?? {}) as { start?: unknown; count?: unknown };
  const startMs = start instanceof Timestamp ? start.toMillis() : NaN;
  const used = Number.isInteger(count) ? (count as number) : 0;
  if (Number.isNaN(startMs) || now - startMs >= quota.windowMs) {
    // A daily window opens at today's 00:00:00 UTC and so ends at the next one
    return { start: Timestamp.fromMillis(quota.alignToUtcDay ? utcDayStart(now) : now), count: 1 };
  }
  if (used >= quota.max) return { retryAfterMs: startMs + quota.windowMs - now };
  return { start: start as Timestamp, count: used + 1 };
}

/**
 * When the document may be deleted (a TTL policy on expireAt): no earlier
 * than the end of every window it still holds, including the one this
 * attempt didn't touch. A short window can outlive the daily one.
 */
function latestEnd(doc: Record<string, unknown>): Timestamp {
  const ends = (["forums", "comments", "daily"] as const).map((name) => {
    const start = (doc[name] as { start?: unknown } | undefined)?.start;
    return start instanceof Timestamp ? start.toMillis() + PUBLISH_LIMITS[name].windowMs : 0;
  });
  return Timestamp.fromMillis(Math.max(...ends));
}

/**
 * Atomically admits one publishing attempt for this verified UID, or says
 * how long to wait. Nothing is written when refused. Under heavy contention
 * for one user's document the transaction can give up (ABORTED); that is
 * reported as PublishLimitStoreError, never as an admission.
 */
export async function admitPublish(db: Firestore, uid: string, kind: "forum" | "comment", now = Date.now()): Promise<Admission> {
  const ref = db.collection(PUBLISH_LIMIT_COLLECTION).doc(uid);
  const field = kind === "forum" ? "forums" : "comments";
  try {
    return await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() ?? {};
      const short = take(data[field], PUBLISH_LIMITS[field], now);
      const daily = take(data.daily, PUBLISH_LIMITS.daily, now);
      const waits = [short, daily].flatMap((w) => ("retryAfterMs" in w ? [w.retryAfterMs] : []));
      if (waits.length > 0) return { ok: false as const, retryAfterMs: Math.max(...waits) };
      const next = { ...data, [field]: short, daily };
      tx.set(ref, { [field]: short, daily, expireAt: latestEnd(next) }, { merge: true });
      return { ok: true as const };
    });
  } catch (error) {
    throw new PublishLimitStoreError(error);
  }
}
