/**
 * @jest-environment node
 *
 * Per-user publishing admission (publish-limits.server.ts) on the in-memory
 * Firestore, with an injected clock. Real transaction concurrency is covered
 * by tests/firestore-rules/publish-limits.test.ts on the emulator.
 */
import { Timestamp } from "firebase-admin/firestore";
import { FakeFirestore } from "../__fixtures__/fake-firestore";
import {
  admitPublish,
  PUBLISH_LIMITS,
  PUBLISH_LIMIT_COLLECTION,
  PublishLimitStoreError,
} from "../publish-limits.server";

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0); // 12:00:00 UTC
const MIDNIGHT = Date.UTC(2026, 10, 8); // the next 00:00:00 UTC
const MIN = 60_000;

let db: FakeFirestore;
beforeEach(() => {
  db = new FakeFirestore();
});

const admit = (kind: "forum" | "comment", uid = "dana", now = T0) => admitPublish(db as never, uid, kind, now);
const admitTimes = async (n: number, kind: "forum" | "comment", uid = "dana", now = T0) => {
  for (let i = 0; i < n; i++) expect(await admit(kind, uid, now)).toEqual({ ok: true });
};

describe("admitPublish", () => {
  it("admits forums below the limit and refuses at the boundary", async () => {
    await admitTimes(PUBLISH_LIMITS.forums.max, "forum");
    expect(await admit("forum", "dana", T0 + 10 * MIN)).toEqual({ ok: false, retryAfterMs: PUBLISH_LIMITS.forums.windowMs - 10 * MIN });
  });

  it("admits comments below the limit and refuses at the boundary", async () => {
    await admitTimes(PUBLISH_LIMITS.comments.max, "comment");
    expect(await admit("comment")).toEqual({ ok: false, retryAfterMs: PUBLISH_LIMITS.comments.windowMs });
  });

  it("starts a new window once the old one has passed", async () => {
    await admitTimes(PUBLISH_LIMITS.forums.max, "forum");
    expect((await admit("forum", "dana", T0 + PUBLISH_LIMITS.forums.windowMs - 1)).ok).toBe(false);
    expect(await admit("forum", "dana", T0 + PUBLISH_LIMITS.forums.windowMs)).toEqual({ ok: true });
  });

  it("keeps users independent", async () => {
    await admitTimes(PUBLISH_LIMITS.forums.max, "forum", "dana");
    expect((await admit("forum", "dana")).ok).toBe(false);
    expect(await admit("forum", "erin")).toEqual({ ok: true });
  });

  it("keeps forum and comment windows independent", async () => {
    await admitTimes(PUBLISH_LIMITS.forums.max, "forum");
    expect(await admit("comment")).toEqual({ ok: true });
  });

  it("caps forums and comments together per day", async () => {
    // Spread over enough short windows that only the daily cap can refuse
    const { comments, daily } = PUBLISH_LIMITS;
    let now = T0;
    for (let used = 0; used < daily.max; used += comments.max) {
      await admitTimes(Math.min(comments.max, daily.max - used), "comment", "dana", now);
      now += comments.windowMs;
    }
    // The daily allowance resets at the next 00:00:00 UTC
    expect(await admit("forum", "dana", now)).toEqual({ ok: false, retryAfterMs: MIDNIGHT - now });
    expect((await admit("comment", "dana", now)).ok).toBe(false);
    expect((await admit("forum", "dana", MIDNIGHT - 1)).ok).toBe(false); // 23:59:59.999
    expect(await admit("forum", "dana", MIDNIGHT)).toEqual({ ok: true }); // 00:00:00.000
  });

  it("keeps counting a window whose start is slightly ahead of this request's clock", async () => {
    // Another instance (or a request that read the clock later) opened the window
    await admitTimes(PUBLISH_LIMITS.forums.max, "forum", "dana", T0 + 50);
    const refused = await admit("forum", "dana", T0);
    expect(refused).toEqual({ ok: false, retryAfterMs: PUBLISH_LIMITS.forums.windowMs + 50 });
  });

  it("does not count a refused attempt", async () => {
    await admitTimes(PUBLISH_LIMITS.forums.max, "forum");
    const before = db.read(PUBLISH_LIMIT_COLLECTION, "dana");
    await admit("forum");
    expect(db.read(PUBLISH_LIMIT_COLLECTION, "dana")).toEqual(before);
  });

  it("stores only window counters and an expiry, keyed by UID", async () => {
    await admit("comment");
    const doc = db.read(PUBLISH_LIMIT_COLLECTION, "dana")!;
    expect(Object.keys(doc).sort()).toEqual(["comments", "daily", "expireAt"]);
    expect(doc.comments).toEqual({ start: expect.anything(), count: 1 });
    expect((doc.daily as { start: { toMillis(): number } }).start.toMillis()).toBe(Date.UTC(2026, 10, 7)); // 00:00:00 UTC today
    expect((doc.expireAt as { toMillis(): number }).toMillis()).toBe(MIDNIGHT);
  });

  it("keeps the document until every retained window has ended, across the daily boundary", async () => {
    const { forums, comments, daily } = PUBLISH_LIMITS;
    const end = (w: unknown, ms: number) => (w as { start: { toMillis(): number } }).start.toMillis() + ms;
    const expiry = () => (db.read(PUBLISH_LIMIT_COLLECTION, "dana")!.expireAt as { toMillis(): number }).toMillis();
    await admit("comment", "dana", T0); // today's daily window ends at MIDNIGHT
    expect(expiry()).toBe(MIDNIGHT);
    const forumAt = MIDNIGHT - 30 * MIN; // 23:30: the forum window runs to 00:30, past the daily window
    await admit("forum", "dana", forumAt);
    expect(expiry()).toBe(forumAt + forums.windowMs);
    const commentAt = MIDNIGHT - MIN; // 23:59: the comment window runs to 00:09
    await admit("comment", "dana", commentAt);
    const doc = db.read(PUBLISH_LIMIT_COLLECTION, "dana")!;
    // The forum window was not touched by this comment, and must still be covered
    expect(expiry()).toBe(Math.max(end(doc.forums, forums.windowMs), end(doc.comments, comments.windowMs), end(doc.daily, daily.windowMs)));
    expect(expiry()).toBe(forumAt + forums.windowMs);
    expect(expiry()).toBeGreaterThanOrEqual(commentAt + comments.windowMs);
  });

  it.each([
    ["the year 2000 rollover", Date.UTC(2000, 0, 1)],
    ["a leap day", Date.UTC(2024, 2, 1)], // 2024-02-29 -> 03-01
    ["the 32-bit time_t limit (2038-01-19 03:14:08)", Date.UTC(2038, 0, 20)],
    ["a century that is not a leap year (2100)", Date.UTC(2100, 2, 1)], // 2100-02-28 -> 03-01
  ])("resets the daily allowance exactly at 00:00:00 UTC across %s", async (_label, midnight) => {
    const { daily } = PUBLISH_LIMITS;
    // A full day, opened at the previous midnight
    db.seed(PUBLISH_LIMIT_COLLECTION, "dana", { daily: { start: Timestamp.fromMillis(midnight - 24 * 60 * MIN), count: daily.max } });
    expect(await admit("forum", "dana", midnight - 1000)).toEqual({ ok: false, retryAfterMs: 1000 }); // 23:59:59
    expect(await admit("forum", "dana", midnight)).toEqual({ ok: true }); // 00:00:00
    const doc = db.read(PUBLISH_LIMIT_COLLECTION, "dana")!;
    expect((doc.daily as { start: { toMillis(): number }; count: number }).start.toMillis()).toBe(midnight);
    expect((doc.daily as { count: number }).count).toBe(1);
    expect((doc.expireAt as { toMillis(): number }).toMillis()).toBe(midnight + 24 * 60 * MIN);
  });

  it("treats a daily window already in tomorrow (another server's clock) as current", async () => {
    db.seed(PUBLISH_LIMIT_COLLECTION, "dana", { daily: { start: Timestamp.fromMillis(MIDNIGHT), count: PUBLISH_LIMITS.daily.max } });
    // This server still reads 23:59:59.900; it must not reset the new day's count
    expect(await admit("comment", "dana", MIDNIGHT - 100)).toEqual({ ok: false, retryAfterMs: 24 * 60 * MIN + 100 });
  });

  it("fails closed rather than crashing when the clock is beyond the supported date range", async () => {
    await expect(admit("forum", "dana", Date.UTC(9999, 11, 31, 12))).rejects.toBeInstanceOf(PublishLimitStoreError);
  });

  it("treats a malformed stored window as a fresh one", async () => {
    db.seed(PUBLISH_LIMIT_COLLECTION, "dana", { forums: { start: "yesterday", count: "lots" }, daily: null });
    expect(await admit("forum")).toEqual({ ok: true });
  });

  it("throws PublishLimitStoreError when quota storage fails, on read or write", async () => {
    db.failures.set(PUBLISH_LIMIT_COLLECTION, Object.assign(new Error("UNAVAILABLE"), { code: 14 }));
    await expect(admit("forum")).rejects.toBeInstanceOf(PublishLimitStoreError);
    db.failures.clear();
    db.writeFailures.set(PUBLISH_LIMIT_COLLECTION, new Error("DEADLINE_EXCEEDED"));
    await expect(admit("comment")).rejects.toBeInstanceOf(PublishLimitStoreError);
  });

  it("never admits more than the limit under concurrent calls", async () => {
    const results = await Promise.all(Array.from({ length: PUBLISH_LIMITS.forums.max + 4 }, () => admit("forum")));
    expect(results.filter((r) => r.ok)).toHaveLength(PUBLISH_LIMITS.forums.max);
  });
});
