/**
 * @jest-environment node
 */
import {
  AdminConfigError,
  assertAdcProject,
  assertServiceAccountProject,
  readAdminProjectId,
} from "../admin-project.server";

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

describe("assertServiceAccountProject", () => {
  it("accepts a service account from the configured project", () => {
    expect(() =>
      assertServiceAccountProject("firebase-adminsdk-x@devtalk-88046.iam.gserviceaccount.com", "devtalk-88046")
    ).not.toThrow();
  });

  it.each([
    "firebase-adminsdk-x@codesocietycapstone.iam.gserviceaccount.com",
    "svc@devtalk-88046.iam.gserviceaccount.com.evil.dev",
    "123-compute@developer.gserviceaccount.com",
  ])("rejects %s without echoing it", (email) => {
    const error = errorFrom(() => assertServiceAccountProject(email, "devtalk-88046"));
    expect(error).toBeInstanceOf(AdminConfigError);
    expect(error.message).not.toContain(email);
  });
});

describe("assertAdcProject", () => {
  const noFile = jest.fn(() => {
    throw new Error("should not read");
  });

  it("accepts ADC with no project overrides", () => {
    expect(() => assertAdcProject({}, "devtalk-88046", noFile)).not.toThrow();
    expect(noFile).not.toHaveBeenCalled();
  });

  it.each(["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"])("rejects %s pointing at another project", (name) => {
    const error = errorFrom(() =>
      assertAdcProject({ [name]: "codesocietycapstone" }, "devtalk-88046", noFile)
    );
    expect(error.message).toBe(`${name} does not match FIREBASE_ADMIN_PROJECT_ID.`);
  });

  it("accepts matching Google Cloud project env vars", () => {
    const env = { GOOGLE_CLOUD_PROJECT: "devtalk-88046", GCLOUD_PROJECT: "devtalk-88046" };
    expect(() => assertAdcProject(env, "devtalk-88046", noFile)).not.toThrow();
  });

  const withKeyFile = (contents: string) => () =>
    assertAdcProject({ GOOGLE_APPLICATION_CREDENTIALS: "/keys/sa.json" }, "devtalk-88046", () => contents);

  it("rejects a key file from another project without echoing its contents", () => {
    const contents = JSON.stringify({
      type: "service_account",
      project_id: "codesocietycapstone",
      private_key: "FAKE-KEY-BODY",
    });
    const error = errorFrom(withKeyFile(contents));
    expect(error.message).toBe("GOOGLE_APPLICATION_CREDENTIALS belongs to a different project.");
    expect(error.message).not.toContain("FAKE-KEY-BODY");
  });

  it("accepts a key file from the configured project", () => {
    expect(withKeyFile(JSON.stringify({ project_id: "devtalk-88046" }))).not.toThrow();
  });

  it("accepts files without a project, such as a federated config", () => {
    expect(withKeyFile(JSON.stringify({ type: "external_account" }))).not.toThrow();
  });

  it("rejects an unreadable key file with a sanitized message", () => {
    expect(errorFrom(withKeyFile("not json FAKE-KEY-BODY")).message).toBe(
      "GOOGLE_APPLICATION_CREDENTIALS could not be read as JSON."
    );
  });
});
