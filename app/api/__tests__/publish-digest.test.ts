/**
 * @jest-environment node
 */
import { commentDigest, forumDigest } from "../publish.server";

const forum = {
  title: "T",
  description: "D",
  question: "Q",
  category: "Other",
  timeLimitHours: 24,
  anonymous: false,
  requestId: "3b241101-e2bb-4255-8caf-4136c566a962",
};
const comment = { forumId: "f1", content: "Hi", anonymous: false, requestId: forum.requestId };

describe("submission digests", () => {
  it("are deterministic SHA-256 hex", () => {
    expect(forumDigest("u1", forum)).toBe(forumDigest("u1", { ...forum }));
    expect(commentDigest("u1", comment)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("change with the user and with every published field, but not with the requestId", () => {
    const base = forumDigest("u1", forum);
    expect(forumDigest("u2", forum)).not.toBe(base);
    for (const patch of [{ title: "T2" }, { description: "D2" }, { question: "Q2" }, { category: "Education" }, { timeLimitHours: 1 }, { anonymous: true }]) {
      expect(forumDigest("u1", { ...forum, ...patch })).not.toBe(base);
    }
    expect(forumDigest("u1", { ...forum, requestId: "other" })).toBe(base);

    const c = commentDigest("u1", comment);
    for (const patch of [{ forumId: "f2" }, { content: "Hi!" }, { anonymous: true }]) {
      expect(commentDigest("u1", { ...comment, ...patch })).not.toBe(c);
    }
  });

  it("separate operations and field boundaries", () => {
    // Moving text between fields changes the digest (array encoding, no concatenation)
    expect(forumDigest("u1", { ...forum, title: "ab", description: "c" })).not.toBe(
      forumDigest("u1", { ...forum, title: "a", description: "bc" })
    );
    expect(commentDigest("u1", { ...comment, forumId: "T" })).not.toBe(forumDigest("u1", forum));
  });
});
