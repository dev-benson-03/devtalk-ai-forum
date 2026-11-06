/**
 * @jest-environment node
 */
import { AdminConfigError, readAdminProjectId } from "../admin-project.server";

function errorFrom(fn: () => unknown): AdminConfigError {
  try {
    fn();
  } catch (error) {
    return error as AdminConfigError;
  }
  throw new Error("expected an AdminConfigError");
}

describe("readAdminProjectId", () => {
  it("accepts the configured DevTalk project", () => {
    expect(readAdminProjectId({ FIREBASE_ADMIN_PROJECT_ID: "devtalk-88046" })).toBe("devtalk-88046");
    expect(readAdminProjectId({ FIREBASE_ADMIN_PROJECT_ID: " devtalk-88046 " })).toBe("devtalk-88046");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
  ])("rejects a %s project ID", (_label, value) => {
    const error = errorFrom(() => readAdminProjectId({ FIREBASE_ADMIN_PROJECT_ID: value }));
    expect(error).toBeInstanceOf(AdminConfigError);
    expect(error.message).toBe("FIREBASE_ADMIN_PROJECT_ID must be set.");
  });

  it.each(["codesocietycapstone", "some-other-project", "devtalk-88046-staging"])(
    "rejects the %s project without echoing it",
    (projectId) => {
      const error = errorFrom(() => readAdminProjectId({ FIREBASE_ADMIN_PROJECT_ID: projectId }));
      expect(error).toBeInstanceOf(AdminConfigError);
      expect(error.code).toBe("admin/invalid-config");
      expect(error.message).not.toContain(projectId);
    }
  );
});
