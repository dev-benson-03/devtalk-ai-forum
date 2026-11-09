# Legacy data: risks, a read-only audit tool and migration safeguards

The 43 Firestore documents migrated to `devtalk-88046` were **not read,
changed, moderated or backfilled**, then or since. This page is based on
the code, the Phase 3A rules tests and the migration notes. Actual counts
can only come from an explicitly approved production read-only audit (see
the safeguards at the end).

## Findings

| # | Issue | Cause | Effect today (code on `test` + this PR) |
| --- | --- | --- | --- |
| 1 | `commentCount` drift | Before Phase 3A the comment and the `increment(1)` were two separate writes, so a failure between them lost a count. An admin comment delete (rules allow it) doesn't decrement. | The forum list and forum page show "N responses" from `commentCount`, so the number can be wrong. Publishing is unaffected: the server reads the stored count and adds 1. What's Tea counts real comments itself. |
| 2 | Forums missing `isActive` / `isAdminDeleted` | Created before those fields existed | Not in the forum list: the list query needs both fields, and rules are not filters. Still opens by direct link. The server treats missing flags as active and not deleted, so they still accept comments. |
| 3 | Comment IDs | Old comments have random IDs. Phase 3A browser comments used `<forumId>_<n>`. | **No longer a risk.** The server publishes with random IDs and never needs the old scheme. Reads use `where forumId ==` and don't depend on the ID. |
| 4 | `endTime` values that aren't Timestamps (e.g. ISO strings), or missing | Older client code | String `endTime`: the server and the old rules treat the forum as closed, and `forum-detail.tsx` / `forumspage.tsx` call `endTime.toDate()`, which throws on a string (existing bug). Missing `endTime`: the forum stays open. |
| 5 | Content never moderated | Published before this policy | Shown to everyone and fed to What's Tea. New posts are moderated; old ones are not. |
| 6 | Comments without `forumId` | Unknown older shape | The rules can't authorize reading them (the read rule needs the parent forum), so they never appear. |

## Audit tool (read-only, local only)

`scripts/legacy-audit/` finds the problems above and proposes corrections
without changing anything.

| File | Role |
| --- | --- |
| `audit.ts` | Pure logic: findings, proposed patches, manual-review items. No I/O. |
| `sources.ts` | Adapters: a JSON fixture, or the Firestore emulator only |
| `cli.mjs` | Command line. Prints a JSON report. |
| `fixtures/legacy-sample.json` | Synthetic legacy shapes used by the tests |

```
node scripts/legacy-audit/cli.mjs --fixture scripts/legacy-audit/fixtures/legacy-sample.json
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/legacy-audit/cli.mjs --emulator --project demo-devtalk
```

Node 22.18 or later runs the TypeScript files directly, so there is no new
dependency.

### What it can't do

- **No writes:** there is no apply, write or production mode. The code
  calls no `set`, `update`, `create`, `delete`, batch or transaction. The
  emulator tests compare every document's data and update time before and
  after an audit.
- **No production target:** the emulator adapter refuses before loading the
  Admin SDK unless all of these hold:
  - `FIRESTORE_EMULATOR_HOST` is a loopback address with a port
    (`127.0.0.1`, `localhost` or `[::1]`);
  - the project is a `demo-*` project, which the Firebase tooling never
    connects to a real project.

  It checks `process.env`, the same environment the Admin SDK reads, and
  takes no separate environment argument. It checks the host again before
  creating the client and before each read, so a change after validation
  fails closed.

  The CLI also refuses:
  - any other argument;
  - two targets at once;
  - when `GOOGLE_APPLICATION_CREDENTIALS` or the app's admin credential
    variables are set.

  It never uses the app's admin setup (`app/firebase/admin.server.ts`), and
  it turns off cloud metadata-server detection so no credential lookup
  leaves the machine. A future production audit would need a separate,
  explicitly approved change.
- **No content:** the emulator adapter reads with `select(...)` on the
  audited fields only (`isActive`, `isAdminDeleted`, `endTime`,
  `commentCount`, `moderationPolicy`, `forumId`), so titles, text, names and
  emails never leave Firestore. The fixture adapter drops every other field
  the same way. Reports contain document paths, codes, counts and the
  proposed values, never stored text. A stored value is echoed only when it
  is a number, a boolean or a valid ISO date being converted.

### Findings and correction rules

Categories can overlap, so the report gives unique affected-document totals
separately from the per-category counts.

| Category | Action | Rule |
| --- | --- | --- |
| `forum_is_active_missing` | propose `isActive: true` | Missing already means active (rules, `canViewForum`). An explicit `false` is never touched. |
| `forum_is_admin_deleted_missing` | propose `isAdminDeleted: false` | Missing already means not deleted |
| `forum_visibility_invalid_type` | manual review | Any non-boolean, including `null` and `"true"`, is never coerced |
| `forum_end_time_missing` | manual review | Today it means open indefinitely, which may be intended. No value is invented. |
| `forum_end_time_string_convertible` | propose a Timestamp | Only a strict ISO 8601 instant with `Z` or an offset (see below) |
| `forum_end_time_invalid` | manual review | Date-only, no time zone, other formats, impossible dates, numbers, maps or `null` |
| `forum_comment_count_missing` / `_invalid` / `_mismatch` | propose the counted value | The count is comments whose `forumId` names an existing forum. Invalid means not a non-negative integer. |
| `forum_moderation_unknown` / `_unrecognized` | report only | Provenance unknown, not unsafe. Nothing is moderated or stamped, and a recognized marker doesn't prove the content is safe. Recognized: `sfw-2026-11-06` and `sfw-2026-11-07`. |
| `comment_forum_id_invalid` | manual review | Missing, empty or not a string |
| `comment_orphaned` | manual review | The forum doesn't exist. No parent is inferred and nothing is deleted. |
| `comment_moderation_unknown` / `_unrecognized` | report only | As for forums |

**`endTime` string contract:** only `YYYY-MM-DDTHH:mm[:ss[.fff]]` followed
by `Z` or `±HH:MM` is accepted.
- **Range checks:** every part is range-checked, with no rollover. Feb 30,
  Feb 29 in 2025 or 2100, hour 24, second 60 and offsets beyond ±14:00 are
  rejected.
- **Ambiguous forms:** `2026-05-01` (which time zone?), `2026-03-01T12:00:00`
  (whose local time?) and `01/02/2026` (January or February?) are reported,
  never guessed.
- **Years:** four-digit years are built without the two-digit-year shortcut.

**Proposed corrections** carry `expect`: what each field must still be (for
example `{ "missing": true }` or `{ "type": "number", "value": -1 }`) for a
future apply to write it. Numbers JSON can't carry exactly (`NaN`,
`Infinity`, `-Infinity`, `-0`) are written as `{ "$number": "NaN" }` and so
on, so the report survives a JSON round trip unchanged. The plan converges: applying it to an in-memory
copy and auditing again proposes nothing (unit test).

**Synthetic sample** (`fixtures/legacy-sample.json`):
- 10 forums and 9 comments inspected.
- 26 findings on 13 distinct documents (8 forums, 5 comments).
- 6 proposed corrections and 12 manual-review items.

These are test expectations only. Real counts are unknown until an approved
production audit.

### Live-scan consistency

A scan reads forums and comments at slightly different moments. Comments
published or deleted during or after the scan make a proposed
`commentCount` stale, and any field can change after the audit. The report
is a plan, not a source of truth, until each value is re-checked at write
time (below).

## Safeguards for any future data change (proposal, not implemented)

Each of these needs Devyn's explicit approval, separately:

1. **Production read-only audit:** a separately reviewed, explicitly
   authorized run against `devtalk-88046`, reading the same fields only.
   Its counts become the expected counts for everything after it.
2. **Backup before any mutation:** a managed export (`gcloud firestore
   export` to a private bucket; billed) or a field-level snapshot of every
   document the plan touches, stored outside the repo.
3. **Backup verification:** count and checksum the backup against the
   audit, and restore it into the emulator or a scratch project to prove it
   is complete before any production write.
4. **Per-document preconditions:** each write runs in a transaction that
   re-reads the document and applies only if every `expect` still holds, or
   uses the document's update time from the audit as a precondition.
   Otherwise the change is skipped and reported.
5. **Changes after the audit:** skipped documents are re-audited, not
   forced. New legacy-shaped documents shouldn't appear, because the server
   is the only writer since Phase 3B.
6. **`commentCount` reconciliation:** recount a forum's comments inside the
   same transaction that writes its count, or pause comment publishing for
   that forum during maintenance, so the count can't race a new comment.
   Admin comment deletes should later go through the server and decrement
   in the same transaction.
7. **Small batches:** for example 50 documents at a time, with a progress
   record of completed paths, so a partial failure can resume without
   repeating or skipping work. Each batch reports applied, skipped and
   failed counts.
8. **Rollback:** restore a field only if it still holds the value the
   migration wrote (a precondition again), so a legitimate later change is
   never overwritten. Anything else is reported for manual handling.
9. **Explicit approval for each action:** separately for the production
   audit, the backup, each correction category's apply, and any decision on
   manual-review items. Moderation of legacy content, and hiding or
   deleting it, are separate decisions and out of scope here.
