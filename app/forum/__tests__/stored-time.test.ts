/**
 * The browser-side reading contract for stored dates. Clocks are passed in,
 * so nothing depends on the machine's current time.
 */
import { Timestamp } from "firebase/firestore";
import { parseEndTimeString } from "../../../scripts/legacy-audit/audit";
import { compareStoredDates, forumWindow, readStoredDate, storedDateText } from "../stored-time";

const NOW = new Date("2026-06-01T12:00:00Z");
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

describe("readStoredDate", () => {
  it("reads Firestore Timestamps and timestamp-like values", () => {
    expect(readStoredDate(ts("2026-01-15T10:00:00Z"))?.toISOString()).toBe("2026-01-15T10:00:00.000Z");
    expect(readStoredDate({ toDate: () => new Date("2026-01-15T10:00:00Z") })?.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it.each([
    ["2026-01-15T10:00:00Z", "2026-01-15T10:00:00.000Z"],
    ["2026-07-04T18:30:00.5-04:00", "2026-07-04T22:30:00.500Z"],
    ["2024-02-29T00:00:00+00:00", "2024-02-29T00:00:00.000Z"],
  ])("reads the zoned ISO string %s", (value, iso) => {
    expect(readStoredDate(value)?.toISOString()).toBe(iso);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["a date-only string (which time zone?)", "2026-05-01"],
    ["a zone-less string", "2026-03-01T12:00:00"],
    ["an impossible date", "2026-02-30T00:00:00Z"],
    ["a US-style date", "01/02/2026"],
    ["free text", "next Tuesday"],
    ["an empty string", ""],
    ["a number (seconds or milliseconds?)", 1767225600000],
    ["NaN", NaN],
    ["a boolean", true],
    ["an array", ["2026-01-15T10:00:00Z"]],
    ["a plain seconds/nanoseconds map", { seconds: 1767225600, nanoseconds: 0 }],
    ["toDate that isn't a function", { toDate: "2026-01-15" }],
    ["toDate that throws", { toDate: () => { throw new Error("boom"); } }],
    ["toDate returning an invalid Date", { toDate: () => new Date(NaN) }],
    ["toDate returning a non-Date", { toDate: () => "2026-01-15T10:00:00Z" }],
  ])("returns null for %s, without throwing", (_label, value) => {
    expect(readStoredDate(value)).toBeNull();
  });

  it("accepts exactly the strings the legacy audit would convert", () => {
    const cases = [
      "2026-01-15T10:00:00Z", "2026-01-15T10:00Z", "2026-07-04T18:30:00.123+05:30", "0099-06-01T00:00:00Z",
      "2026-05-01", "2026-03-01T12:00:00", "2025-02-29T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T23:59:60Z",
      "2026-01-01T00:00:00+15:00", "2026-01-01T00:00:00.1234Z", "2026-01-15 10:00:00Z", " 2026-01-15T10:00:00Z",
    ];
    for (const value of cases) {
      const audit = parseEndTimeString(value);
      expect([value, readStoredDate(value)?.toISOString() ?? null]).toEqual([value, audit.ok ? audit.iso : null]);
    }
  });
});

describe("storedDateText", () => {
  it("formats valid dates the way the views already did", () => {
    const value = ts("2026-01-15T10:00:00Z");
    const date = value.toDate();
    expect(storedDateText(value, "date")).toBe(date.toLocaleDateString());
    expect(storedDateText(value, "dateTime")).toBe(date.toLocaleString());
  });

  it.each([undefined, null, "2026-02-30T00:00:00Z", 42, { toDate: () => new Date(NaN) }])(
    "shows 'Unknown date' for %p, never 'Invalid Date'",
    (value) => {
      expect(storedDateText(value, "date")).toBe("Unknown date");
      expect(storedDateText(value, "dateTime")).toBe("Unknown date");
    }
  );
});

describe("forumWindow follows the server's comment rule", () => {
  it("is open with no end time (legacy forums stay open)", () => {
    expect(forumWindow(undefined, NOW)).toEqual({ accepting: true, end: null });
  });

  it("is open before a Timestamp end time and closed at or after it", () => {
    expect(forumWindow(ts("2026-06-01T12:00:00.001Z"), NOW)).toMatchObject({ accepting: true });
    expect(forumWindow(ts("2026-06-01T12:00:00Z"), NOW)).toMatchObject({ accepting: false });
    expect(forumWindow(ts("2026-05-01T00:00:00Z"), NOW).end?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it.each([
    ["a future ISO string the server doesn't accept", "2030-01-01T00:00:00Z"],
    ["an invalid string", "2026-02-30T00:00:00Z"],
    ["null", null],
    ["a number", 1767225600000],
    ["a malformed timestamp-like value", { toDate: () => { throw new Error("boom"); } }],
  ])("is closed for %s (present but not a valid Timestamp)", (_label, value) => {
    expect(forumWindow(value, NOW)).toEqual({ accepting: false, end: null });
  });
});

describe("compareStoredDates", () => {
  it("orders valid dates ascending, unknown dates first, and never returns NaN", () => {
    const values = [ts("2026-03-01T00:00:00Z"), "bad", ts("2026-01-01T00:00:00Z"), null, "2026-02-01T00:00:00Z", NaN];
    for (const a of values) for (const b of values) expect(Number.isNaN(compareStoredDates(a, b))).toBe(false);
    const sorted = [...values].sort(compareStoredDates).map((v) => readStoredDate(v)?.toISOString() ?? "unknown");
    expect(sorted).toEqual([
      "unknown", "unknown", "unknown",
      "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z",
    ]);
  });
});
