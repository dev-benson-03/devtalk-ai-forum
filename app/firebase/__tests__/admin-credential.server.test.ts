/**
 * @jest-environment node
 */
import { applicationDefault, cert } from "firebase-admin/app";
import { readAdminOptions } from "../admin-credential.server";

jest.mock("firebase-admin/app", () => ({
  applicationDefault: jest.fn(() => ({ kind: "adc" })),
  cert: jest.fn(() => ({ kind: "cert" })),
}));

const FAKE_KEY = "-----BEGIN PRIVATE KEY-----\\nFAKE-KEY-BODY\\n-----END PRIVATE KEY-----";

describe("readAdminOptions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses Application Default Credentials when no key is set", () => {
    const options = readAdminOptions({ FIREBASE_ADMIN_PROJECT_ID: "demo-devtalk" });
    expect(applicationDefault).toHaveBeenCalledTimes(1);
    expect(cert).not.toHaveBeenCalled();
    expect(options).toEqual({ credential: { kind: "adc" }, projectId: "demo-devtalk" });
  });

  it("lets ADC infer the project when no project id is set", () => {
    expect(readAdminOptions({}).projectId).toBeUndefined();
  });

  it("uses the service-account env vars and restores key newlines", () => {
    const options = readAdminOptions({
      FIREBASE_ADMIN_PROJECT_ID: "demo-devtalk",
      FIREBASE_ADMIN_CLIENT_EMAIL: "svc@demo-devtalk.iam.gserviceaccount.com",
      FIREBASE_ADMIN_PRIVATE_KEY: FAKE_KEY,
    });
    expect(applicationDefault).not.toHaveBeenCalled();
    expect(cert).toHaveBeenCalledWith({
      projectId: "demo-devtalk",
      clientEmail: "svc@demo-devtalk.iam.gserviceaccount.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\nFAKE-KEY-BODY\n-----END PRIVATE KEY-----",
    });
    expect(options.projectId).toBe("demo-devtalk");
  });

  it("names missing variables without echoing any values", () => {
    let message = "";
    try {
      readAdminOptions({ FIREBASE_ADMIN_PRIVATE_KEY: FAKE_KEY });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("FIREBASE_ADMIN_PROJECT_ID");
    expect(message).toContain("FIREBASE_ADMIN_CLIENT_EMAIL");
    expect(message).not.toContain("FIREBASE_ADMIN_PRIVATE_KEY");
    expect(message).not.toContain("FAKE-KEY-BODY");
    expect(cert).not.toHaveBeenCalled();
  });
});
