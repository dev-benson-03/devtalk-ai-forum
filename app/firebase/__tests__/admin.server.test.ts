/**
 * @jest-environment node
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { ADMIN_APP_NAME, getAdminApp, getAdminAuth, getAdminDb } from "../admin.server";

const apps: Array<{ name: string }> = [];

jest.mock("firebase-admin/app", () => ({
  getApps: jest.fn(() => apps),
  initializeApp: jest.fn((_options: unknown, name: string) => {
    const app = { name };
    apps.push(app);
    return app;
  }),
  applicationDefault: jest.fn(() => ({ kind: "adc" })),
  cert: jest.fn(),
}));
jest.mock("firebase-admin/auth", () => ({ getAuth: jest.fn(() => ({ kind: "auth" })) }));
jest.mock("firebase-admin/firestore", () => ({ getFirestore: jest.fn(() => ({ kind: "db" })) }));

describe("admin.server", () => {
  beforeEach(() => {
    apps.length = 0;
    jest.clearAllMocks();
  });

  it("initializes a named app once and reuses it", () => {
    const first = getAdminApp();
    const second = getAdminApp();
    expect(first).toBe(second);
    expect(first.name).toBe(ADMIN_APP_NAME);
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it("reuses an app that already exists, e.g. after a hot reload", () => {
    apps.push({ name: ADMIN_APP_NAME });
    getAdminApp();
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it("ignores other Firebase apps with different names", () => {
    apps.push({ name: "[DEFAULT]" });
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
