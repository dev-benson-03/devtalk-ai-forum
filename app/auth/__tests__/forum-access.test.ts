import { canForceRegenerate, canViewForum, isAdmin, isCreator } from "../forum-access";

const user = (uid: string, claims: Record<string, unknown> = {}) =>
  ({ uid, token: { uid, ...claims } }) as never;

const owner = user("owner-uid");
const other = user("other-uid");
const admin = user("admin-uid", { admin: true });

const open = { creatorId: "owner-uid", isActive: true, isAdminDeleted: false };

describe("forum access", () => {
  it("lets any signed-in user view an open forum", () => {
    expect(canViewForum(other, open)).toBe(true);
    expect(canViewForum(other, {})).toBe(true); // legacy docs without flags
  });

  it("hides admin-deleted forums from everyone but admins, including the creator", () => {
    const deleted = { ...open, isAdminDeleted: true };
    expect(canViewForum(other, deleted)).toBe(false);
    expect(canViewForum(owner, deleted)).toBe(false);
    expect(canViewForum(admin, deleted)).toBe(true);
  });

  it("limits inactive forums to the creator and admins", () => {
    const inactive = { ...open, isActive: false };
    expect(canViewForum(other, inactive)).toBe(false);
    expect(canViewForum(owner, inactive)).toBe(true);
    expect(canViewForum(admin, inactive)).toBe(true);
  });

  it("only lets the creator or an admin force regeneration", () => {
    expect(canForceRegenerate(owner, open)).toBe(true);
    expect(canForceRegenerate(admin, open)).toBe(true);
    expect(canForceRegenerate(other, open)).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["anonymous", "anonymous"],
    ["non-string", 123],
  ])("treats a %s creatorId as owned by nobody", (_label, creatorId) => {
    const forum = { creatorId };
    expect(isCreator(user(String(creatorId)), forum)).toBe(false);
    expect(canForceRegenerate(user("anonymous"), forum)).toBe(false);
  });

  it.each([["true as a string", "true"], ["1", 1], ["missing", undefined]])(
    "does not treat an admin claim of %s as admin",
    (_label, value) => {
      expect(isAdmin(user("x", { admin: value }))).toBe(false);
    }
  );
});
