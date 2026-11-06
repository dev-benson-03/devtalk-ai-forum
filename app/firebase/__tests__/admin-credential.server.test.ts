/**
 * @jest-environment node
 */
import { applicationDefault, cert } from "firebase-admin/app";
import { readAdminOptions } from "../admin-credential.server";
import { AdminConfigError } from "../admin-project.server";

jest.mock("firebase-admin/app", () => ({
  applicationDefault: jest.fn(() => ({ kind: "adc" })),
  cert: jest.fn(() => ({ kind: "cert" })),
}));

const PROJECT = "devtalk-88046";
const EMAIL = "firebase-adminsdk-x@devtalk-88046.iam.gserviceaccount.com";
const FAKE_KEY = "-----BEGIN PRIVATE KEY-----\\nFAKE-KEY-BODY\\n-----END PRIVATE KEY-----";
const noFile = () => {
  throw new Error("no key file expected");
};

function errorFrom(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected an error");
}

describe("readAdminOptions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses ADC pinned to the configured project", () => {
    const options = readAdminOptions({ FIREBASE_ADMIN_PROJECT_ID: PROJECT }, noFile);
    expect(applicationDefault).toHaveBeenCalledTimes(1);
    expect(cert).not.toHaveBeenCalled();
    expect(options).toEqual({ credential: { kind: "adc" }, projectId: PROJECT });
  });

  it("refuses to let ADC infer a project when none is configured", () => {
    const error = errorFrom(() => readAdminOptions({ GOOGLE_CLOUD_PROJECT: PROJECT }, noFile));
    expect(error).toBeInstanceOf(AdminConfigError);
    expect(applicationDefault).not.toHaveBeenCalled();
  });

  it("stops ADC env settings from redirecting to another project", () => {
    const env = { FIREBASE_ADMIN_PROJECT_ID: PROJECT, GOOGLE_CLOUD_PROJECT: "codesocietycapstone" };
    expect(errorFrom(() => readAdminOptions(env, noFile))).toBeInstanceOf(AdminConfigError);
    expect(applicationDefault).not.toHaveBeenCalled();
  });

  it("stops an ADC key file from another project", () => {
    const env = { FIREBASE_ADMIN_PROJECT_ID: PROJECT, GOOGLE_APPLICATION_CREDENTIALS: "/k.json" };
    const readFile = () => JSON.stringify({ project_id: "codesocietycapstone" });
    expect(errorFrom(() => readAdminOptions(env, readFile))).toBeInstanceOf(AdminConfigError);
    expect(applicationDefault).not.toHaveBeenCalled();
  });

  it("uses the service-account env vars and restores key newlines", () => {
    const options = readAdminOptions({
      FIREBASE_ADMIN_PROJECT_ID: PROJECT,
      FIREBASE_ADMIN_CLIENT_EMAIL: EMAIL,
      FIREBASE_ADMIN_PRIVATE_KEY: FAKE_KEY,
    });
    expect(applicationDefault).not.toHaveBeenCalled();
    expect(cert).toHaveBeenCalledWith({
      projectId: PROJECT,
      clientEmail: EMAIL,
      privateKey: "-----BEGIN PRIVATE KEY-----\nFAKE-KEY-BODY\n-----END PRIVATE KEY-----",
    });
    expect(options.projectId).toBe(PROJECT);
  });

  it("rejects a service account from another project", () => {
    const error = errorFrom(() =>
      readAdminOptions({
        FIREBASE_ADMIN_PROJECT_ID: PROJECT,
        FIREBASE_ADMIN_CLIENT_EMAIL: "svc@codesocietycapstone.iam.gserviceaccount.com",
        FIREBASE_ADMIN_PRIVATE_KEY: FAKE_KEY,
      })
    );
    expect(error).toBeInstanceOf(AdminConfigError);
    expect(error.message).not.toContain("codesocietycapstone");
    expect(cert).not.toHaveBeenCalled();
  });

  it.each(["codesocietycapstone", "", "   "])("rejects project %j even with a key set", (projectId) => {
    const error = errorFrom(() =>
      readAdminOptions({
        FIREBASE_ADMIN_PROJECT_ID: projectId,
        FIREBASE_ADMIN_CLIENT_EMAIL: EMAIL,
        FIREBASE_ADMIN_PRIVATE_KEY: FAKE_KEY,
      })
    );
    expect(error).toBeInstanceOf(AdminConfigError);
    expect(cert).not.toHaveBeenCalled();
  });

  it("names missing variables without echoing any values", () => {
    const error = errorFrom(() =>
      readAdminOptions({ FIREBASE_ADMIN_PROJECT_ID: PROJECT, FIREBASE_ADMIN_PRIVATE_KEY: FAKE_KEY })
    );
    expect(error).toBeInstanceOf(AdminConfigError);
    expect(error.message).toContain("FIREBASE_ADMIN_CLIENT_EMAIL");
    expect(error.message).not.toContain("FIREBASE_ADMIN_PRIVATE_KEY");
    expect(error.message).not.toContain("FAKE-KEY-BODY");
    expect(cert).not.toHaveBeenCalled();
  });
});
