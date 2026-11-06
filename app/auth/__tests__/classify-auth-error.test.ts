import { classifyAuthError } from "../classify-auth-error";

const withCode = (code: unknown) => Object.assign(new Error("SDK message with SECRET"), { code });

describe("classifyAuthError", () => {
  it.each([
    "auth/argument-error",
    "auth/invalid-id-token",
    "auth/id-token-expired",
    "auth/id-token-revoked",
    "auth/user-disabled",
    "auth/user-not-found",
  ])("maps %s to 401", (code) => {
    expect(classifyAuthError(withCode(code))).toEqual({ status: 401, category: "invalid_token", code });
  });

  it.each(["auth/internal-error", "auth/quota-exceeded", "app/network-error", "app/network-timeout"])(
    "maps %s to 503",
    (code) => {
      expect(classifyAuthError(withCode(code))).toEqual({ status: 503, category: "service_unavailable", code });
    }
  );

  it.each([
    "admin/invalid-config",
    "auth/invalid-credential",
    "app/invalid-credential",
    "auth/insufficient-permission",
    "auth/project-not-found",
  ])("maps %s to 500", (code) => {
    expect(classifyAuthError(withCode(code))).toEqual({ status: 500, category: "server_config", code });
  });

  it("treats other auth/* codes as unexpected 500s, not 401s", () => {
    expect(classifyAuthError(withCode("auth/billing-not-enabled"))).toEqual({
      status: 500,
      category: "unexpected",
      code: "auth/billing-not-enabled",
    });
  });

  it.each([
    ["a plain Error", new Error("boom")],
    ["null", null],
    ["a string", "auth/id-token-expired"],
    ["a non-string code", withCode(401)],
    ["a code carrying token text", withCode("auth/eyJhbGciOiJSUzI1NiJ9.payload")],
  ])("maps %s to an unexpected 500 with a safe code", (_label, error) => {
    expect(classifyAuthError(error)).toEqual({ status: 500, category: "unexpected", code: "unknown" });
  });
});
