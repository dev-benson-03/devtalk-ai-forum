import { errorCode } from "../error-code";

describe("errorCode", () => {
  it("keeps Firebase-style codes", () => {
    expect(errorCode({ code: "auth/wrong-password" })).toBe("auth/wrong-password");
    expect(errorCode({ code: "permission-denied" })).toBe("permission-denied");
  });

  it("drops messages, emails and anything else", () => {
    const error = Object.assign(new Error("dana@example.com typed something"), {
      code: "dana@example.com",
      customData: { email: "dana@example.com" },
    });
    expect(errorCode(error)).toBe("unknown");
    expect(errorCode(new Error("Private text"))).toBe("unknown");
    expect(errorCode(null)).toBe("unknown");
  });
});
