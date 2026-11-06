/**
 * @jest-environment node
 */
import type { Firestore } from "firebase-admin/firestore";
import { FakeFirestore } from "../__fixtures__/fake-firestore";
import type { TrustedComment } from "../analysis-comments";
import {
  ANALYSIS_VERSION,
  CACHE_COLLECTION,
  analysisCacheKey,
  cacheEntry,
  readCachedAnalysis,
} from "../analysis-cache.server";

const context = { title: "React", description: "Ask", question: "What next?", category: "react" };
const c = (id: string, content: string, parentId?: string): TrustedComment => ({ id, content, parentId, createdAtMs: 0 });
const comments = [c("c1", "secret comment text"), c("c2", "Second")];
const analysis = { summary: "A valid summary here.", actionRoadmap: ["Step one", "Step two", "Step three"] };

describe("analysisCacheKey", () => {
  const key = analysisCacheKey("f1", context, comments);

  it("is deterministic, forum-scoped, SHA-256 based and free of comment text", () => {
    expect(analysisCacheKey("f1", context, [...comments])).toBe(key);
    expect(key).toMatch(/^f1_[0-9a-f]{64}$/);
    expect(key).not.toContain("secret");
  });

  it.each([
    ["a new comment", "f1", context, [...comments, c("c3", "Third")]],
    ["an edited comment", "f1", context, [comments[0], c("c2", "Second, edited")]],
    ["a deleted comment", "f1", context, [comments[0]]],
    ["a changed thread", "f1", context, [comments[0], c("c2", "Second", "c1")]],
    ["an edited forum question", "f1", { ...context, question: "Changed?" }, comments],
    ["another forum", "f2", context, comments],
  ])("changes after %s", (_label, forumId, ctx, list) => {
    expect(analysisCacheKey(forumId as string, ctx as typeof context, list as TrustedComment[])).not.toBe(key);
  });
});

describe("cache reads and writes", () => {
  let fake: FakeFirestore;
  const db = () => fake as unknown as Firestore;
  beforeEach(() => {
    fake = new FakeFirestore();
  });

  it("round-trips a validated analysis with metadata and timestamps", async () => {
    fake.seed(CACHE_COLLECTION, "k1", cacheEntry("f1", analysis, { totalMessages: 2, uniqueAuthors: 1 }, 1_000));
    const stored = fake.read(CACHE_COLLECTION, "k1")!;
    expect(stored).toMatchObject({ forumId: "f1", version: ANALYSIS_VERSION, model: "gpt-4o-mini", ...analysis });
    expect(stored.createdAt).toBeDefined();
    expect((stored.expireAt as { toMillis(): number }).toMillis()).toBeGreaterThan(1_000);
    expect(await readCachedAnalysis(db(), "k1", "f1")).toEqual({ status: "hit", analysis });
  });

  it("reports a miss for a missing entry", async () => {
    expect(await readCachedAnalysis(db(), "nope", "f1")).toEqual({ status: "miss" });
  });

  it.each([
    ["another forum's entry", { forumId: "f2" }],
    ["an older version", { version: "old" }],
    ["a two-step roadmap", { actionRoadmap: ["Step one", "Step two"] }],
    ["an empty summary", { summary: "" }],
    ["a legacy entry without metadata", { forumId: undefined, version: undefined }],
  ])("treats %s as invalid", async (_label, patch) => {
    fake.seed(CACHE_COLLECTION, "k1", { forumId: "f1", version: ANALYSIS_VERSION, ...analysis, ...patch });
    expect(await readCachedAnalysis(db(), "k1", "f1")).toEqual({ status: "invalid" });
  });
});
