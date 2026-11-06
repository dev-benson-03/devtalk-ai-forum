const mockGetIdTokenResult = jest.fn();
jest.mock("firebase/auth", () => ({
  getIdTokenResult: (...args: unknown[]) => mockGetIdTokenResult(...args),
}));

import { clearLegacyRoleFlags, hasAdminClaim } from "../admin-claim";

const user = { uid: "u1" } as never;

describe("hasAdminClaim", () => {
  beforeEach(() => mockGetIdTokenResult.mockReset());

  it("is true only for admin === true on the ID token", async () => {
    mockGetIdTokenResult.mockResolvedValueOnce({ claims: { admin: true } });
    expect(await hasAdminClaim(user, true)).toBe(true);
    expect(mockGetIdTokenResult).toHaveBeenCalledWith(user, true);
    for (const admin of [undefined, false, "true", 1, null]) {
      mockGetIdTokenResult.mockResolvedValueOnce({ claims: { admin } });
      expect(await hasAdminClaim(user)).toBe(false);
    }
  });

  it("is false when signed out or the token can't be read", async () => {
    expect(await hasAdminClaim(null)).toBe(false);
    mockGetIdTokenResult.mockRejectedValueOnce(new Error("auth/user-token-expired"));
    expect(await hasAdminClaim(user)).toBe(false);
  });
});

it("clearLegacyRoleFlags removes the old sessionStorage role keys", () => {
  const storage = { removeItem: jest.fn() };
  clearLegacyRoleFlags(storage);
  expect(storage.removeItem).toHaveBeenCalledWith("role");
  expect(storage.removeItem).toHaveBeenCalledWith("admin");
});
