import { ANALYZE_LIMITS } from "../analyze-request";
import {
  authorKey,
  countUniqueAuthors,
  selectForAnalysis,
  toTrustedComment,
  type TrustedComment,
} from "../analysis-comments";

const at = (ms: number) => ({ toMillis: () => ms });
const comment = (overrides: Partial<TrustedComment> = {}): TrustedComment => ({
  id: "c1",
  content: "hello",
  createdAtMs: 0,
  ...overrides,
});

describe("toTrustedComment", () => {
  it("keeps only analysis fields from a Firestore comment", () => {
    expect(
      toTrustedComment("c1", {
        forumId: "f1",
        userId: "uid-1",
        userName: "Dana",
        content: "Hi",
        createdAt: at(1000),
        upvotes: 3,
        email: "dana@example.com",
      })
    ).toEqual({ id: "c1", content: "Hi", userId: "uid-1", userName: "Dana", parentId: undefined, createdAtMs: 1000 });
  });

  it("tolerates legacy or malformed docs", () => {
    expect(toTrustedComment("c2", { content: 42, userId: "", createdAt: "yesterday" })).toEqual({
      id: "c2",
      content: "",
      userId: undefined,
      userName: undefined,
      parentId: undefined,
      createdAtMs: 0,
    });
  });
});

describe("countUniqueAuthors", () => {
  it("counts one author with multiple comments once", () => {
    const comments = [comment({ userId: "u1" }), comment({ userId: "u1" }), comment({ userId: "u1" })];
    expect(countUniqueAuthors(comments)).toBe(1);
  });

  it("counts multiple unique authors", () => {
    const comments = [comment({ userId: "u1" }), comment({ userId: "u2" }), comment({ userId: "u3" })];
    expect(countUniqueAuthors(comments)).toBe(3);
  });

  it("separates two users who share a display name when UIDs exist", () => {
    const comments = [comment({ userId: "u1", userName: "Sam" }), comment({ userId: "u2", userName: "Sam" })];
    expect(countUniqueAuthors(comments)).toBe(2);
  });

  it("falls back to the display name for legacy comments with only userName", () => {
    const comments = [
      comment({ userName: "Dana" }),
      comment({ userName: " dana " }),
      comment({ userName: "Lee" }),
    ];
    expect(countUniqueAuthors(comments)).toBe(2);
  });

  it("does not count comments with no identifiable author", () => {
    const comments = [
      comment({}),
      comment({ userId: "anonymous", userName: "Anonymous User" }),
      comment({ userName: "Anonymous User" }),
      comment({ userId: "u1" }),
    ];
    expect(countUniqueAuthors(comments)).toBe(1);
    expect(authorKey(comments[0])).toBeNull();
  });

  it("counts a signed-in user posting in anonymous mode by UID", () => {
    expect(authorKey(comment({ userId: "u1", userName: "Anonymous User" }))).toBe("uid:u1");
  });

  it("returns 0 for no comments", () => {
    expect(countUniqueAuthors([])).toBe(0);
  });
});

describe("selectForAnalysis", () => {
  it("orders comments oldest first", () => {
    const picked = selectForAnalysis([
      comment({ id: "b", createdAtMs: 2 }),
      comment({ id: "a", createdAtMs: 1 }),
    ]);
    expect(picked.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("keeps only the newest maxMessages comments", () => {
    const many = Array.from({ length: ANALYZE_LIMITS.maxMessages + 5 }, (_, i) =>
      comment({ id: `c${i}`, createdAtMs: i })
    );
    const picked = selectForAnalysis(many);
    expect(picked).toHaveLength(ANALYZE_LIMITS.maxMessages);
    expect(picked[0].id).toBe("c5");
  });

  it("truncates long comments and drops the oldest past the total limit", () => {
    const long = "x".repeat(ANALYZE_LIMITS.maxContentChars + 50);
    const count = ANALYZE_LIMITS.maxTotalContentChars / ANALYZE_LIMITS.maxContentChars + 2;
    const picked = selectForAnalysis(
      Array.from({ length: count }, (_, i) => comment({ id: `c${i}`, content: long, createdAtMs: i }))
    );
    expect(picked.every((c) => c.content.length === ANALYZE_LIMITS.maxContentChars)).toBe(true);
    expect(picked.reduce((n, c) => n + c.content.length, 0)).toBeLessThanOrEqual(
      ANALYZE_LIMITS.maxTotalContentChars
    );
    expect(picked[0].id).toBe("c2");
  });
});
