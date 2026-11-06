import { readBearerToken } from "../bearer-token";

describe("readBearerToken", () => {
  it("returns the token from a Bearer header", () => {
    expect(readBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(readBearerToken("bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it.each([
    ["missing header", null],
    ["empty header", ""],
    ["scheme only", "Bearer"],
    ["scheme and spaces", "Bearer   "],
    ["wrong scheme", "Basic dXNlcjpwYXNz"],
    ["token without scheme", "abc.def.ghi"],
    ["two tokens", "Bearer abc def"],
  ])("returns null for %s", (_label, header) => {
    expect(readBearerToken(header)).toBeNull();
  });
});
