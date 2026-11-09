/**
 * @jest-environment node
 *
 * The pure legacy-data audit on synthetic fixtures. No Firestore, no writes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditLegacyData, parseEndTimeString, RECOGNIZED_MODERATION_POLICIES, type AuditInput, type DocFields } from "../audit";
import { fixtureToInput } from "../sources";

const FIXTURE = join(__dirname, "..", "fixtures", "legacy-sample.json");
const loadSample = (): AuditInput => fixtureToInput(JSON.parse(readFileSync(FIXTURE, "utf8")));
const ts = (iso: string) => ({ toMillis: () => Date.parse(iso) });
const ok = (fields: DocFields = {}): DocFields => ({
  isActive: true,
  isAdminDeleted: false,
  endTime: ts("2026-12-01T00:00:00Z"),
  commentCount: 0,
  moderationPolicy: "sfw-2026-11-07",
  ...fields,
});
const audit = (forums: Record<string, DocFields>, comments: Record<string, DocFields> = {}) =>
  auditLegacyData({
    forums: Object.entries(forums).map(([id, fields]) => ({ id, fields })),
    comments: Object.entries(comments).map(([id, fields]) => ({ id, fields })),
  });

describe("parseEndTimeString (strict contract)", () => {
  it.each([
    ["2026-01-15T10:00:00Z", "2026-01-15T10:00:00.000Z"],
    ["2026-01-15T10:00Z", "2026-01-15T10:00:00.000Z"],
    ["2026-07-04T18:30:00.5-04:00", "2026-07-04T22:30:00.500Z"],
    ["2026-07-04T18:30:00.123+05:30", "2026-07-04T13:00:00.123Z"],
    ["2024-02-29T00:00:00Z", "2024-02-29T00:00:00.000Z"],
    ["2000-01-01T00:00:00Z", "2000-01-01T00:00:00.000Z"],
    ["0099-06-01T00:00:00Z", "0099-06-01T00:00:00.000Z"], // no two-digit-year shortcut to 1999
  ])("accepts %s", (input, iso) => {
    expect(parseEndTimeString(input)).toEqual({ ok: true, iso });
  });

  it.each([
    ["2026-05-01", "date_only"],
    ["2026-03-01T12:00:00", "no_time_zone"],
    ["01/02/2026", "unrecognized_format"],
    ["Jan 2 2026", "unrecognized_format"],
    ["", "unrecognized_format"],
    [" 2026-01-15T10:00:00Z", "unrecognized_format"],
    ["2026-01-15 10:00:00Z", "unrecognized_format"],
    ["2026-02-30T00:00:00Z", "out_of_range"],
    ["2025-02-29T00:00:00Z", "out_of_range"],
    ["2100-02-29T00:00:00Z", "out_of_range"],
    ["2026-13-01T00:00:00Z", "out_of_range"],
    ["2026-01-01T24:00:00Z", "out_of_range"],
    ["2026-01-01T23:59:60Z", "out_of_range"],
    ["2026-01-01T00:00:00+15:00", "out_of_range"],
    ["2026-01-01T00:00:00.1234Z", "unrecognized_format"],
  ])("rejects %s as %s without inventing a value", (input, reason) => {
    expect(parseEndTimeString(input)).toEqual({ ok: false, reason });
  });
});

describe("auditLegacyData", () => {
  it("finds nothing in correct documents", () => {
    const report = audit(
      { a: ok({ commentCount: 1 }), b: ok({ isActive: false }), c: ok({ isAdminDeleted: true }) },
      { x: { forumId: "a", moderationPolicy: "sfw-2026-11-06" } }
    );
    expect(report.affectedDocuments).toEqual({ forums: 0, comments: 0, total: 0 });
    expect(report.proposedCorrections).toEqual([]);
    expect(report.manualReview).toEqual([]);
    expect(Object.values(report.findingCounts).every((n) => n === 0)).toBe(true);
  });

  it("proposes defaults only for missing visibility flags and never overrides explicit false", () => {
    const report = audit({ missing: ok({ isActive: undefined, isAdminDeleted: undefined }), hidden: ok({ isActive: false }) });
    expect(report.proposedCorrections).toEqual([
      {
        path: "forums/missing",
        set: { isActive: true, isAdminDeleted: false },
        expect: { isActive: { missing: true }, isAdminDeleted: { missing: true } },
        reasons: ["forum_is_active_missing", "forum_is_admin_deleted_missing"],
      },
    ]);
    expect(report.findings.forum_is_active_missing).toEqual(["forums/missing"]);
  });

  it.each([
    ["a string", "true", "string"],
    ["null", null, "null"],
    ["a number", 1, "number"],
  ])("sends %s visibility flag to manual review without coercing it", (_label, value, type) => {
    const report = audit({ f: ok({ isAdminDeleted: value }) });
    expect(report.proposedCorrections).toEqual([]);
    expect(report.manualReview).toEqual([
      { path: "forums/f", category: "forum_visibility_invalid_type", field: "isAdminDeleted", detail: `type:${type}` },
    ]);
  });

  it("accepts Timestamp endTime, proposes conversion for a strict ISO string, and reports the rest", () => {
    const report = audit({
      t: ok(),
      s: ok({ endTime: "2026-01-15T10:00:00Z" }),
      bad: ok({ endTime: "2026-02-30T00:00:00Z" }),
      none: ok({ endTime: undefined }),
      num: ok({ endTime: 1767225600000 }),
      map: ok({ endTime: { seconds: 1, nanoseconds: 0 } }),
    });
    expect(report.proposedCorrections).toEqual([
      {
        path: "forums/s",
        set: { endTime: { $timestamp: "2026-01-15T10:00:00.000Z" } },
        expect: { endTime: { type: "string", value: "2026-01-15T10:00:00Z" } },
        reasons: ["forum_end_time_string_convertible"],
      },
    ]);
    expect(report.manualReview).toEqual([
      { path: "forums/bad", category: "forum_end_time_invalid", field: "endTime", detail: "out_of_range" },
      { path: "forums/map", category: "forum_end_time_invalid", field: "endTime", detail: "type:map" },
      { path: "forums/none", category: "forum_end_time_missing", field: "endTime", detail: "open_indefinitely" },
      { path: "forums/num", category: "forum_end_time_invalid", field: "endTime", detail: "type:number" },
    ]);
  });

  it.each([
    ["missing", undefined, "forum_comment_count_missing", { missing: true }],
    ["negative", -1, "forum_comment_count_invalid", { type: "number", value: -1 }],
    ["fractional", 1.5, "forum_comment_count_invalid", { type: "number", value: 1.5 }],
    ["nonnumeric", "2", "forum_comment_count_invalid", { type: "string" }],
    ["inaccurate", 7, "forum_comment_count_mismatch", { type: "number", value: 7 }],
  ])("reconciles a %s commentCount to the counted comments", (_label, stored, category, expected) => {
    const report = audit({ f: ok({ commentCount: stored }) }, { a: { forumId: "f" }, b: { forumId: "f" } });
    expect(report.proposedCorrections).toEqual([
      { path: "forums/f", set: { commentCount: 2 }, expect: { commentCount: expected }, reasons: [category] },
    ]);
  });

  it.each([
    ["NaN", NaN, "NaN"],
    ["Infinity", Infinity, "Infinity"],
    ["-Infinity", -Infinity, "-Infinity"],
  ])("tags a non-finite stored count (%s) so the expectation survives JSON", (_label, stored, tag) => {
    const report = audit({ f: ok({ commentCount: stored }) }, { a: { forumId: "f" } });
    expect(report.proposedCorrections).toEqual([
      {
        path: "forums/f",
        set: { commentCount: 1 },
        expect: { commentCount: { type: "number", value: { $number: tag } } },
        reasons: ["forum_comment_count_invalid"],
      },
    ]);
    // Nothing turns into null when the report is serialized
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("tags negative zero, which JSON would otherwise print as 0", () => {
    const report = audit({ f: ok({ commentCount: -0, isActive: undefined }) });
    expect(report.proposedCorrections[0].expect).toEqual({ isActive: { missing: true } });
    const negZero = audit({ f: ok({ commentCount: -0 }) }, { a: { forumId: "f" } });
    expect(negZero.proposedCorrections[0].expect.commentCount).toEqual({ type: "number", value: { $number: "-0" } });
    expect(JSON.parse(JSON.stringify(negZero))).toEqual(negZero);
  });

  it("counts only comments with a valid reference to an existing forum", () => {
    const report = audit(
      { f: ok({ commentCount: 1 }), g: ok({ commentCount: 0 }) },
      { a: { forumId: "f" }, b: { forumId: "missing" }, c: {}, d: { forumId: "" }, e: { forumId: ["f"] } }
    );
    expect(report.proposedCorrections).toEqual([]);
    expect(report.findings.comment_orphaned).toEqual(["comments/b"]);
    expect(report.findings.comment_forum_id_invalid).toEqual(["comments/c", "comments/d", "comments/e"]);
    expect(report.manualReview.map((m) => [m.path, m.detail])).toEqual([
      ["comments/b", "parent_not_found"],
      ["comments/c", "missing"],
      ["comments/d", "empty"],
      ["comments/e", "type:array"],
    ]);
  });

  it("reports missing or unrecognized moderation markers without proposing anything", () => {
    const report = audit({ f: ok({ moderationPolicy: undefined }), g: ok({ moderationPolicy: "approved" }) }, {
      a: { forumId: "f" },
      b: { forumId: "f", moderationPolicy: 7 },
    });
    expect(report.findings.forum_moderation_unknown).toEqual(["forums/f"]);
    expect(report.findings.forum_moderation_unrecognized).toEqual(["forums/g"]);
    expect(report.findings.comment_moderation_unknown).toEqual(["comments/a"]);
    expect(report.findings.comment_moderation_unrecognized).toEqual(["comments/b"]);
    expect(report.proposedCorrections).toEqual([{ path: "forums/f", set: { commentCount: 2 }, expect: { commentCount: { type: "number", value: 0 } }, reasons: ["forum_comment_count_mismatch"] }]);
    expect(report.manualReview).toEqual([]);
    expect(RECOGNIZED_MODERATION_POLICIES).toEqual(["sfw-2026-11-06", "sfw-2026-11-07"]);
  });

  it("produces the exact expected report for the synthetic sample", () => {
    const report = auditLegacyData(loadSample());
    expect(report.mode).toBe("read-only");
    expect(report.writesPerformed).toBe(0);
    expect(report.inspected).toEqual({ forums: 10, comments: 9 });
    expect(report.findings).toEqual({
      forum_is_active_missing: ["forums/f-legacy-missing"],
      forum_is_admin_deleted_missing: ["forums/f-legacy-missing"],
      forum_visibility_invalid_type: ["forums/f-bad-types"],
      forum_end_time_missing: ["forums/f-legacy-missing"],
      forum_end_time_string_convertible: ["forums/f-bad-types", "forums/f-offset"],
      forum_end_time_invalid: ["forums/f-ambiguous", "forums/f-bad-date", "forums/f-date-only", "forums/f-no-zone", "forums/f-number-end"],
      forum_comment_count_missing: ["forums/f-legacy-missing", "forums/f-offset"],
      forum_comment_count_invalid: ["forums/f-ambiguous", "forums/f-bad-types", "forums/f-no-zone"],
      forum_comment_count_mismatch: ["forums/f-bad-date"],
      forum_moderation_unknown: ["forums/f-ambiguous", "forums/f-legacy-missing"],
      forum_moderation_unrecognized: ["forums/f-bad-types"],
      comment_forum_id_invalid: ["comments/c4", "comments/c5", "comments/c6"],
      comment_orphaned: ["comments/c7"],
      comment_moderation_unknown: ["comments/c3", "comments/c7"],
      comment_moderation_unrecognized: [],
    });
    expect(Object.values(report.findingCounts).reduce((a, b) => a + b, 0)).toBe(26);
    // Categories overlap: 26 findings on 13 distinct documents
    expect(report.affectedDocuments).toEqual({ forums: 8, comments: 5, total: 13 });
    expect(report.proposedCorrections.map((c) => [c.path, c.set])).toEqual([
      ["forums/f-ambiguous", { commentCount: 0 }],
      ["forums/f-bad-date", { commentCount: 0 }],
      ["forums/f-bad-types", { endTime: { $timestamp: "2026-01-15T10:00:00.000Z" }, commentCount: 1 }],
      ["forums/f-legacy-missing", { isActive: true, isAdminDeleted: false, commentCount: 1 }],
      ["forums/f-no-zone", { commentCount: 0 }],
      ["forums/f-offset", { endTime: { $timestamp: "2026-07-04T22:30:00.500Z" }, commentCount: 1 }],
    ]);
    expect(report.manualReview.map((m) => `${m.path} ${m.category} ${m.field} ${m.detail}`)).toEqual([
      "comments/c4 comment_forum_id_invalid forumId missing",
      "comments/c5 comment_forum_id_invalid forumId empty",
      "comments/c6 comment_forum_id_invalid forumId type:number",
      "comments/c7 comment_orphaned forumId parent_not_found",
      "forums/f-ambiguous forum_end_time_invalid endTime unrecognized_format",
      "forums/f-bad-date forum_end_time_invalid endTime out_of_range",
      "forums/f-bad-types forum_visibility_invalid_type isActive type:string",
      "forums/f-bad-types forum_visibility_invalid_type isAdminDeleted type:null",
      "forums/f-date-only forum_end_time_invalid endTime date_only",
      "forums/f-legacy-missing forum_end_time_missing endTime open_indefinitely",
      "forums/f-no-zone forum_end_time_invalid endTime no_time_zone",
      "forums/f-number-end forum_end_time_invalid endTime type:number",
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const input = loadSample();
    const shuffled = { forums: [...input.forums].reverse(), comments: [...input.comments].reverse() };
    expect(JSON.stringify(auditLegacyData(shuffled))).toBe(JSON.stringify(auditLegacyData(input)));
  });

  it("never includes submitted text, names, emails or other fields", () => {
    const text = JSON.stringify(auditLegacyData(loadSample()));
    for (const marker of ["PRIVATE-TEXT", "PRIVATE-NAME", "pat@example.com", "uid-alice", "uid-bo", "\"creatorName\"", "\"title\"", "\"content\"", "\"userName\"", "\"creatorId\""]) {
      expect(text).not.toContain(marker);
    }
  });

  it("converges: after applying its own patches in memory, a second audit proposes nothing", () => {
    const input = loadSample();
    const first = auditLegacyData(input);
    const patched: AuditInput = {
      comments: input.comments,
      forums: input.forums.map((doc) => {
        const correction = first.proposedCorrections.find((c) => c.path === `forums/${doc.id}`);
        if (!correction) return doc;
        const set = Object.fromEntries(
          Object.entries(correction.set).map(([k, v]) =>
            v && typeof v === "object" && "$timestamp" in v ? [k, ts((v as { $timestamp: string }).$timestamp)] : [k, v]
          )
        );
        return { id: doc.id, fields: { ...doc.fields, ...set } };
      }),
    };
    const second = auditLegacyData(patched);
    expect(second.proposedCorrections).toEqual([]);
    // Manual-review and report-only findings are untouched by the plan
    expect(second.manualReview).toEqual(first.manualReview);
    expect(second.findings.forum_moderation_unknown).toEqual(first.findings.forum_moderation_unknown);
    expect(second.findings.comment_orphaned).toEqual(first.findings.comment_orphaned);
  });
});
