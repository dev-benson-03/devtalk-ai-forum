/**
 * @jest-environment node
 *
 * The browser's posting rule against the server's: same answers on the same
 * synthetic forums. The server module is imported here, in the test only;
 * the browser code never imports it.
 */
import { Timestamp } from "firebase-admin/firestore";
import { acceptsComments } from "../../api/publish.server";
import { postingEligibility, postingUnavailableMessage } from "../posting-eligibility";

const NOW = new Date("2026-06-01T12:00:00Z");
const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const FLAGS: Array<[string, Record<string, unknown>]> = [
  ["listed", { isActive: true, isAdminDeleted: false }],
  ["missing flags", {}],
  ["hidden", { isActive: false }],
  ["hidden and deleted", { isActive: false, isAdminDeleted: true }],
  ["deleted", { isAdminDeleted: true }],
  ["isActive 'false' string", { isActive: "false" }],
  ["isActive null", { isActive: null }],
  ["isAdminDeleted 'true' string", { isAdminDeleted: "true" }],
  ["isAdminDeleted 1", { isAdminDeleted: 1 }],
];
const END_TIMES: Array<[string, unknown]> = [
  ["missing", undefined],
  ["future Timestamp", at("2026-06-02T00:00:00Z")],
  ["past Timestamp", at("2026-05-01T00:00:00Z")],
  ["Timestamp exactly now", at("2026-06-01T12:00:00Z")],
  ["ISO string", "2030-01-01T00:00:00Z"],
  ["null", null],
  ["number", 1767225600000],
  ["map", { seconds: 1767225600, nanoseconds: 0 }],
];

describe("postingEligibility matches the server's acceptsComments", () => {
  for (const [flagLabel, flags] of FLAGS) {
    for (const [endLabel, endTime] of END_TIMES) {
      it(`${flagLabel}, end time ${endLabel}`, () => {
        const forum = endTime === undefined ? { ...flags } : { ...flags, endTime };
        expect(postingEligibility(forum, NOW).accepting).toBe(acceptsComments(forum, NOW));
      });
    }
  }
});

describe("postingEligibility reasons and display", () => {
  it.each([
    [{ isAdminDeleted: true, isActive: false }, "deleted"],
    [{ isActive: false, endTime: at("2026-06-02T00:00:00Z") }, "hidden"],
    [{ endTime: at("2026-05-01T00:00:00Z") }, "ended"],
    [{ endTime: "2030-01-01T00:00:00Z" }, "end_time_unreadable"],
  ])("gives %p the reason %s", (forum, reason) => {
    expect(postingEligibility(forum, NOW)).toMatchObject({ accepting: false, reason });
  });

  it("keeps the end date only when it applies", () => {
    expect(postingEligibility({ endTime: at("2026-06-02T00:00:00Z") }, NOW).end?.toISOString()).toBe("2026-06-02T00:00:00.000Z");
    expect(postingEligibility({ endTime: at("2026-05-01T00:00:00Z") }, NOW).end?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    // A hidden forum shows no "closes on" date, which would suggest it is open
    expect(postingEligibility({ isActive: false, endTime: at("2026-06-02T00:00:00Z") }, NOW).end).toBeNull();
  });

  it("explains each reason without internal detail", () => {
    expect(postingUnavailableMessage("ended")).toBe("This forum has closed and no longer accepts new messages.");
    for (const reason of ["hidden", "deleted", "end_time_unreadable"] as const) {
      expect(postingUnavailableMessage(reason)).toBe("This forum isn't accepting new messages.");
    }
  });
});
