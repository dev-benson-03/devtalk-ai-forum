/**
 * @jest-environment node
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { ADMIN_APP_NAME, getAdminApp, getAdminAuth, getAdminDb } from "../admin.server";
import { AdminConfigError } from "../admin-project.server";

type FakeApp = { name: string; options: { projectId?: string } };
const apps: FakeApp[] = [];

jest.mock("firebase-admin/app", () => ({
  getApps: jest.fn(() => apps),
  initializeApp: jest.fn((options: { projectId?: string }, name: string) => {
    const app = { name, options };
    apps.push(app);
    return app;
  }),
  applicationDefault: jest.fn(() => ({ kind: "adc" })),
  cert: jest.fn(),
}));
jest.mock("firebase-admin/auth", () => ({ getAuth: jest.fn(() => ({ kind: "auth" })) }));
jest.mock("firebase-admin/firestore", () => ({ getFirestore: jest.fn(() => ({ kind: "db" })) }));

const ENV_KEYS = ["FIREBASE_ADMIN_PROJECT_ID", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT",
  "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe("admin.server", () => {
  beforeEach(() => {
    apps.length = 0;
    jest.clearAllMocks();
    ENV_KEYS.forEach((key) => delete process.env[key]);
    process.env.FIREBASE_ADMIN_PROJECT_ID = "devtalk-88046";
  });
  afterAll(() => {
    ENV_KEYS.forEach((key) =>
      savedEnv[key] === undefined ? delete process.env[key] : (process.env[key] = savedEnv[key])
    );
  });

  it("initializes a named app once, pinned to the configured project", () => {
    const first = getAdminApp();
    const second = getAdminApp();
    expect(first).toBe(second);
    expect(first.name).toBe(ADMIN_APP_NAME);
    expect(first.options.projectId).toBe("devtalk-88046");
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it("reuses an app that already exists, e.g. after a hot reload", () => {
    apps.push({ name: ADMIN_APP_NAME, options: { projectId: "devtalk-88046" } });
    getAdminApp();
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it("refuses a cached app that targets another project", () => {
    apps.push({ name: ADMIN_APP_NAME, options: { projectId: "codesocietycapstone" } });
    expect(() => getAdminApp()).toThrow(AdminConfigError);
  });

  it("does not initialize without a valid project", () => {
    process.env.FIREBASE_ADMIN_PROJECT_ID = "codesocietycapstone";
    expect(() => getAdminApp()).toThrow(AdminConfigError);
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it("ignores other Firebase apps with different names", () => {
    apps.push({ name: "[DEFAULT]", options: {} });
    expect(getAdminApp().name).toBe(ADMIN_APP_NAME);
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it("builds Auth and Firestore on the admin app", () => {
    getAdminAuth();
    getAdminDb();
    expect(getAuth).toHaveBeenCalledWith(apps[0]);
    expect(getFirestore).toHaveBeenCalledWith(apps[0]);
    expect(getApps).toHaveBeenCalled();
  });
});
