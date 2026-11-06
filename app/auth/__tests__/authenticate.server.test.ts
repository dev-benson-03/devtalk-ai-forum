/**
 * @jest-environment node
 */
import { requireUser } from "../authenticate.server";
import { requireOwner } from "../authorize";

const mockVerifyIdToken = jest.fn();
jest.mock("../../firebase/admin.server", () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const SECRET_TOKEN = "eyJhbGciOiJSUzI1NiJ9.SECRET-PAYLOAD.SECRET-SIGNATURE";

const requestWith = (authorization?: string) =>
  new Request("http://localhost/api/test", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });

const authError = (code: string) =>
  Object.assign(new Error(`Token ${SECRET_TOKEN} rejected`), { code });

async function thrownBy(promise: Promise<unknown>): Promise<Response> {
  try {
    await promise;
  } catch (thrown) {
    return thrown as Response;
  }
  throw new Error("expected a thrown Response");
}

describe("requireUser", () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    log = jest.spyOn(console, "log").mockImplementation(() => {});
    error = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const loggedText = () =>
    JSON.stringify([warn.mock.calls, log.mock.calls, error.mock.calls]);

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
  ])("rejects a %s with 401 without calling Firebase", async (_label, header) => {
    const response = await thrownBy(requireUser(requestWith(header)));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it.each([
    "auth/id-token-expired",
    "auth/argument-error",
    "auth/id-token-revoked",
    "auth/user-disabled",
  ])("rejects %s with a generic 401", async (code) => {
    mockVerifyIdToken.mockRejectedValue(authError(code));
    const response = await thrownBy(requireUser(requestWith(`Bearer ${SECRET_TOKEN}`)));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(warn).toHaveBeenCalledWith("[auth] ID token rejected:", code);
  });

  it("never logs or returns the token or SDK message", async () => {
    mockVerifyIdToken.mockRejectedValue(authError("auth/id-token-expired"));
    const response = await thrownBy(requireUser(requestWith(`Bearer ${SECRET_TOKEN}`)));
    const body = JSON.stringify(await response.json());
    for (const text of [body, loggedText()]) {
      expect(text).not.toContain("SECRET-PAYLOAD");
      expect(text).not.toContain("SECRET-SIGNATURE");
    }
  });

  it("rethrows non-auth failures so they surface as 500, not 401", async () => {
    const failure = Object.assign(new Error("credential failure"), { code: "app/invalid-credential" });
    mockVerifyIdToken.mockRejectedValue(failure);
    await expect(requireUser(requestWith(`Bearer ${SECRET_TOKEN}`))).rejects.toBe(failure);
  });

  it("accepts an injected Auth instance", async () => {
    const verifyIdToken = jest.fn().mockResolvedValue({ uid: "injected" });
    const user = await requireUser(requestWith("Bearer t"), { verifyIdToken } as never);
    expect(user.uid).toBe("injected");
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });
});

describe("requireOwner", () => {
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
