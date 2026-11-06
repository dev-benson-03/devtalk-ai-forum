import { ANONYMOUS_NAME, authorIdentity } from "../author-identity";
import { buildForumDocument } from "../forum-document";

const user = { uid: "alice-uid", displayName: "Alice", email: "alice@example.com" };

describe("authorIdentity", () => {
  it("always stores the signed-in UID, also when posting anonymously", () => {
    expect(authorIdentity(user, "true")).toEqual({ id: "alice-uid", name: ANONYMOUS_NAME });
    expect(authorIdentity(user, null)).toEqual({ id: "alice-uid", name: ANONYMOUS_NAME });
  });

  it("shows the display name, then email, when visible", () => {
    expect(authorIdentity(user, "false")).toEqual({ id: "alice-uid", name: "Alice" });
    expect(authorIdentity({ uid: "b", email: "b@example.com" }, "false").name).toBe("b@example.com");
    expect(authorIdentity({ uid: "c" }, "false").name).toBe("User");
  });

  it("falls back to the 'anonymous' ID when signed out (the rules reject it)", () => {
    expect(authorIdentity(null, "false")).toEqual({ id: "anonymous", name: ANONYMOUS_NAME });
  });
});

describe("buildForumDocument", () => {
  const form = { title: "T", description: "D", question: "Q?", category: "Technology", timeLimit: 1 };

  it("builds the document the create-forum page has always written", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const forum = buildForumDocument(form, user, "false", now);
    expect(forum).toMatchObject({
      title: "T",
      description: "D",
      question: "Q?",
      creatorId: "alice-uid",
      creatorName: "Alice",
      isActive: true,
      isAdminDeleted: false,
      tags: ["Technology"],
      messages: [""],
      summary: "",
      actionRoadmap: [""],
    });
    expect(forum.endTime.toMillis()).toBe(now.getTime() + 60 * 60 * 1000);
  });

  it("leaves tags empty without a category", () => {
    expect(buildForumDocument({ ...form, category: "" }, user, "true").tags).toEqual([]);
  });
});
