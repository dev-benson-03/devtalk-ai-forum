/**
 * @jest-environment node
 */
import type { Firestore } from "firebase-admin/firestore";
import { FakeFirestore } from "../__fixtures__/fake-firestore";
import {
  ANALYSIS_QUOTAS as Q,
  LimitStoreError,
  RATE_LIMIT_COLLECTION,
  STATE_COLLECTION,
  acquireGeneration,
  consumeUserRequest,
  finishGeneration,
} from "../analysis-limits.server";

const T0 = 1_700_000_000_000;
let fake: FakeFirestore;
const db = () => fake as unknown as Firestore;
const gate = (now: number, uid = "u1", key = "k1", forumId = "f1") =>
  acquireGeneration(db(), { forumId, uid, key }, now);

beforeEach(() => {
  fake = new FakeFirestore();
});

describe("consumeUserRequest", () => {
  it("allows up to the per-user request quota, then returns a retry time", async () => {
    for (let i = 0; i < Q.userRequests.max; i++) {
      expect(await consumeUserRequest(db(), "u1", T0 + i)).toEqual({ ok: true });
    }
    const limited = await consumeUserRequest(db(), "u1", T0 + 1_000);
    expect(limited).toEqual({ ok: false, scope: "user_requests", retryAfterMs: Q.userRequests.windowMs - 1_000 });
    expect(await consumeUserRequest(db(), "u2", T0 + 1_000)).toEqual({ ok: true });
  });

  it("starts a new window after the old one ends", async () => {
    for (let i = 0; i < Q.userRequests.max; i++) await consumeUserRequest(db(), "u1", T0);
    expect(await consumeUserRequest(db(), "u1", T0 + Q.userRequests.windowMs)).toEqual({ ok: true });
  });

  it("throws LimitStoreError when Firestore fails", async () => {
    fake.failures.set(RATE_LIMIT_COLLECTION, Object.assign(new Error("down"), { code: 14 }));
    await expect(consumeUserRequest(db(), "u1", T0)).rejects.toBeInstanceOf(LimitStoreError);
  });
});

describe("acquireGeneration / finishGeneration", () => {
  it("takes the forum lock and reports in_progress to a second request", async () => {
    const first = await gate(T0);
    expect(first).toMatchObject({ kind: "acquired", recoveredStaleLock: false });
    expect(await gate(T0 + 1, "u2")).toEqual({ kind: "in_progress", retryAfterMs: Q.inProgressRetryMs });
  });

  it("lets only one of two simultaneous requests acquire the lock", async () => {
    const results = await Promise.all([gate(T0, "u1"), gate(T0, "u2")]);
    expect(results.map((r) => r.kind).sort()).toEqual(["acquired", "in_progress"]);
  });

  it("recovers a stale lock after its TTL", async () => {
    await gate(T0);
    const later = await gate(T0 + Q.lockTtlMs + 1, "u2");
    expect(later).toMatchObject({ kind: "acquired", recoveredStaleLock: true });
  });

  it("starts the forum cooldown on success and remembers the latest key", async () => {
    const first = await gate(T0);
    if (first.kind !== "acquired") throw new Error("expected lock");
    await finishGeneration(db(), { forumId: "f1", holder: first.holder, key: "k1", succeeded: true }, T0 + 5);
    expect(fake.read(STATE_COLLECTION, "f1")!.lock).toBeNull();
    expect(await gate(T0 + 10, "u2", "k2")).toEqual({
      kind: "cooldown",
      retryAfterMs: Q.forumCooldownMs - 5,
      previousKey: "k1",
    });
    expect(await gate(T0 + 5 + Q.forumCooldownMs, "u2", "k2")).toMatchObject({ kind: "acquired" });
  });

  it("releases the lock without a cooldown after a failed generation", async () => {
    const first = await gate(T0);
    if (first.kind !== "acquired") throw new Error("expected lock");
    await finishGeneration(db(), { forumId: "f1", holder: first.holder, key: "k1", succeeded: false }, T0 + 5);
    expect(await gate(T0 + 10)).toMatchObject({ kind: "acquired" });
  });

  it("does not release a lock another request has since taken over", async () => {
    const first = await gate(T0);
    const second = await gate(T0 + Q.lockTtlMs + 1, "u2");
    if (first.kind !== "acquired" || second.kind !== "acquired") throw new Error("expected locks");
    await finishGeneration(db(), { forumId: "f1", holder: first.holder, key: "k1", succeeded: false });
    expect(fake.read(STATE_COLLECTION, "f1")!.lock).toMatchObject({ holder: second.holder });
  });

  it("enforces the per-user generation quota across forums", async () => {
    for (let i = 0; i < Q.userGenerations.max; i++) {
      expect(await gate(T0 + i, "u1", "k", `forum${i}`)).toMatchObject({ kind: "acquired" });
    }
    expect(await gate(T0 + 100, "u1", "k", "another")).toMatchObject({ kind: "limited", scope: "user_generations" });
  });

  it("enforces the per-forum generation quota across users", async () => {
    for (let i = 0; i < Q.forumGenerations.max; i++) {
      const g = await gate(T0 + i * Q.lockTtlMs * 2, `user${i}`);
      if (g.kind !== "acquired") throw new Error(`attempt ${i}: ${g.kind}`);
      await finishGeneration(db(), { forumId: "f1", holder: g.holder, key: "k", succeeded: false });
    }
    const next = await gate(T0 + Q.forumGenerations.max * Q.lockTtlMs * 2, "fresh-user");
    expect(next).toMatchObject({ kind: "limited", scope: "forum_generations" });
  });

  it("throws LimitStoreError when Firestore fails", async () => {
    fake.failures.set(STATE_COLLECTION, Object.assign(new Error("down"), { code: 14 }));
    await expect(gate(T0)).rejects.toBeInstanceOf(LimitStoreError);
  });
});
