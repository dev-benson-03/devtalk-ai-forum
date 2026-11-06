/**
 * @jest-environment node
 */
import { requireUser } from "../authenticate.server";
import { requireOwner } from "../authorize";
import { AdminConfigError } from "../../firebase/admin-project.server";

const mockVerifyIdToken = jest.fn();
const mockGetAdminAuth = jest.fn(() => ({ verifyIdToken: mockVerifyIdToken }));
jest.mock("../../firebase/admin.server", () => ({
  getAdminAuth: () => mockGetAdminAuth(),
}));

const SECRET_TOKEN = "eyJhbGciOiJSUzI1NiJ9.SECRET-PAYLOAD.SECRET-SIGNATURE";
const SECRET_KEY_TEXT = "FAKE-PRIVATE-KEY-BODY";

const requestWith = (authorization?: string) =>
  new Request("http://localhost/api/test", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });

// An SDK-shaped error whose message and stack contain secrets
const sdkError = (code: string) =>
  Object.assign(new Error(`Token ${SECRET_TOKEN} rejected; key ${SECRET_KEY_TEXT}`), { code });

async function thrownBy(promise: Promise<unknown>): Promise<Response> {
  try {
    await promise;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw new Error(`expected a thrown Response, got ${String(thrown)}`);
  }
  throw new Error("expected a thrown Response");
}

describe("requireUser", () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    mockGetAdminAuth.mockClear();
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    log = jest.spyOn(console, "log").mockImplementation(() => {});
    error = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const loggedText = () => JSON.stringify([warn.mock.calls, log.mock.calls, error.mock.calls]);
  const rejectWith = (code: string) =>
    thrownBy(
      (mockVerifyIdToken.mockRejectedValue(sdkError(code)), requireUser(requestWith(`Bearer ${SECRET_TOKEN}`)))
    );

  it("returns the UID from a valid token, checking revocation", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "user-123", email: "a@b.dev" });
    const user = await requireUser(requestWith(`Bearer ${SECRET_TOKEN}`));
    expect(user.uid).toBe("user-123");
    expect(mockVerifyIdToken).toHaveBeenCalledWith(SECRET_TOKEN, true);
  });

  it.each([
    ["missing header", undefined],
    ["non-Bearer scheme", "Basic dXNlcjpwYXNz"],
    ["empty Bearer token", "Bearer "],
    ["malformed header", "Bearer a b"],
  ])("rejects a %s with 401 without calling Firebase", async (_label, header) => {
    const response = await thrownBy(requireUser(requestWith(header)));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(mockGetAdminAuth).not.toHaveBeenCalled();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed or invalid token", "auth/argument-error"],
    ["invalid token", "auth/invalid-id-token"],
    ["expired token", "auth/id-token-expired"],
    ["revoked token", "auth/id-token-revoked"],
    ["disabled user", "auth/user-disabled"],
    ["deleted user", "auth/user-not-found"],
  ])("rejects a %s with 401", async (_label, code) => {
    const response = await rejectWith(code);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(warn).toHaveBeenCalledWith("[auth]", {
      event: "auth.verify_failed",
      status: 401,
      category: "invalid_token",
      code,
    });
  });

  it.each([
    ["Firebase outage", "auth/internal-error"],
    ["throttling", "auth/quota-exceeded"],
    ["network failure", "app/network-error"],
    ["network timeout", "app/network-timeout"],
  ])("returns 503 for a %s", async (_label, code) => {
    const response = await rejectWith(code);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.json()).toEqual({ error: "Service unavailable" });
    expect(error).toHaveBeenCalledWith("[auth]", expect.objectContaining({ status: 503, code }));
  });

  it.each([
    ["invalid server credentials", "auth/invalid-credential"],
    ["invalid app credentials", "app/invalid-credential"],
    ["insufficient server permissions", "auth/insufficient-permission"],
    ["unknown project", "auth/project-not-found"],
  ])("returns 500 for %s", async (_label, code) => {
    const response = await rejectWith(code);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(error).toHaveBeenCalledWith("[auth]", expect.objectContaining({ category: "server_config", code }));
  });

  it("returns 500 when the Admin SDK config is invalid", async () => {
    mockGetAdminAuth.mockImplementationOnce(() => {
      throw new AdminConfigError("FIREBASE_ADMIN_PROJECT_ID must be set.");
    });
    const response = await thrownBy(requireUser(requestWith(`Bearer ${SECRET_TOKEN}`)));
    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledWith("[auth]", expect.objectContaining({ code: "admin/invalid-config" }));
  });

  it("returns 500 for an unexpected error", async () => {
    mockVerifyIdToken.mockRejectedValue(new TypeError(`bad ${SECRET_TOKEN}`));
    const response = await thrownBy(requireUser(requestWith(`Bearer ${SECRET_TOKEN}`)));
    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledWith("[auth]", expect.objectContaining({ category: "unexpected", code: "unknown" }));
  });

  it.each([
    "auth/id-token-expired",
    "auth/internal-error",
    "auth/invalid-credential",
    "auth/some-new-code",
  ])("never leaks the token, key text, message or stack for %s", async (code) => {
    const response = await rejectWith(code);
    const body = await response.text();
    for (const text of [body, loggedText()]) {
      expect(text).not.toContain("SECRET-PAYLOAD");
      expect(text).not.toContain("SECRET-SIGNATURE");
      expect(text).not.toContain(SECRET_KEY_TEXT);
      expect(text).not.toContain("at ");
    }
  });

  it("accepts an injected Auth instance", async () => {
    const verifyIdToken = jest.fn().mockResolvedValue({ uid: "injected" });
    const user = await requireUser(requestWith("Bearer t"), { verifyIdToken } as never);
    expect(user.uid).toBe("injected");
    expect(mockGetAdminAuth).not.toHaveBeenCalled();
  });
});

describe("requireOwner (authorization, separate from authentication)", () => {
  const user = { uid: "owner-1", token: {} as never };

  it("allows the owner", () => {
    expect(() => requireOwner(user, "owner-1")).not.toThrow();
  });

  it.each([["another user", "owner-2"], ["missing owner", undefined], ["empty owner", ""]])(
    "returns 403 for %s",
    (_label, ownerUid) => {
      let thrown: unknown;
      try {
        requireOwner(user, ownerUid);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as Response).status).toBe(403);
    }
  );
});
