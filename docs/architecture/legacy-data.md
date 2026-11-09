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
| 4 | `endTime` values that aren't Timestamps (e.g. ISO strings), or missing | Older client code | String `endTime`: the server and the old rules treat the forum as closed. The views read dates through `app/forum/stored-time.ts`, so a string or malformed value no longer crashes them (it used to, through `endTime.toDate()`). Missing `endTime`: the forum stays open. |
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

**How the app reads legacy dates** (`app/forum/stored-time.ts`, browser-only):
- **Dates shown:** a Timestamp, or a string under the `endTime` string contract
  below (a test checks the two parsers agree). Anything else shows
  "Unknown date", never "Invalid Date".
- **Open or closed:** the same rule as the server's `acceptsComments`. No
  `endTime` means open; a Timestamp means open until that instant; anything
  else, including `null` and a valid ISO string, means closed and shows
  "Not accepting new messages". The server still decides.
- **Expiry, not visibility:** `forumWindow` only reads `endTime`. On the
  forum page, `postingEligibility` combines it with the hidden and deleted
  flags, as the server's `acceptsComments` does (see "Viewing versus
  posting" in `publishing.md`). Who can see a forum is decided separately
  by `isActive` and `isAdminDeleted` (Firestore rules, the listed-forums
  query and `canViewForum`). A closed forum, including one with an
  unreadable `endTime`, stays viewable with its messages and What's Tea. A
  hidden or admin-deleted forum stays hidden from the list whatever its
  `endTime` says.
- **Order:** unreadable dates sort first (where the old epoch-0 fallback put
  them), with the document ID as the tie-breaker.

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

## Visibility-flag rehearsal (emulator only)

`scripts/visibility-rehearsal/` rehearses one narrow correction against the
Firestore **emulator** with synthetic data. It proves that missing
visibility flags can be backed up, corrected, verified and rolled back
safely. It does **not** authorize or prepare a production run (see below).

**Scope:**
- Only a missing `isActive` gets `true`, and only a missing `isAdminDeleted`
  gets `false`. These are the defaults the rules (`get('isActive', true)`,
  `get('isAdminDeleted', false)`), `canViewForum` and `acceptsComments`
  already apply.
- Explicit `true`/`false`, explicit `null`, invalid types and every other
  field are left alone. `null` and invalid types stay manual-review items.
- Nothing else is in scope: no timestamps, comment counts, moderation,
  deletion, users, production mode or general framework.

**Access stays the same, but the forum list changes.** Adding the defaults
doesn't change who can open a forum: a missing flag already means listed
and not deleted. It does change what people find. The forum list asks
Firestore for `isActive == true` and `isAdminDeleted == false`, and an
equality query never matches a document missing that field. So forums
missing either flag are currently **not listed**, and correcting them
makes them **appear in the list**. A production decision should treat this
as a visible change, not a no-op.

### Commands (emulator only)

```bash
# Start the emulator (demo project), then in another shell:
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
node scripts/visibility-rehearsal/cli.mjs plan     --project demo-devtalk --backup /path/run.json
node scripts/visibility-rehearsal/cli.mjs apply    --project demo-devtalk --backup /path/run.json
node scripts/visibility-rehearsal/cli.mjs verify   --project demo-devtalk --backup /path/run.json
node scripts/visibility-rehearsal/cli.mjs rollback --project demo-devtalk --backup /path/run.json
```

- **Refusals:** the tool exits 2 before any Firestore access for:
  - an unknown command or flag (there is no production flag);
  - a missing `--project` or `--backup`;
  - a non-`demo-*` project;
  - a missing, non-loopback or portless `FIRESTORE_EMULATOR_HOST`;
  - credential variables (`GOOGLE_APPLICATION_CREDENTIALS`,
    `FIREBASE_ADMIN_PRIVATE_KEY`, `FIREBASE_ADMIN_CLIENT_EMAIL`);
  - a missing or invalid backup, for every command except `plan`.
- **Target checks:** these read `process.env`, the environment the Admin
  SDK reads, before firebase-admin is loaded. The host is checked again
  before every database operation, so a change after validation fails
  closed. A named Admin app is used, never `app/firebase/admin.server.ts`,
  and metadata-server detection is off.
- **The audit tool is unchanged and still read-only.** The rehearsal reuses
  its `assertSafeEmulatorTarget` and its missing-flag proposals.

### Artifacts and records

**Backup file** (`--backup`, a local path outside the repo; written with
mode 0600):
- **Write once:** it is created with `wx`, so an existing file is never
  overwritten. It is read back and validated before `plan` reports success.
- **Contents:** `kind`, `version` 1, `migration`
  (`forum-visibility-defaults-v1`), `runId` (random UUID), `projectId`,
  `emulatorHost`, `createdAt`, and `documents[]`.
  - Each document has its `path`, the `updateTime` observed when planning
    (ISO 8601 with all nine fractional digits), `original` and `set`.
  - `original` holds both flags' states, as `{state: "missing"}`,
    `{state: "present", value: true|false|null}` or
    `{state: "present", type}`. Other values are never copied.
  - `set` holds only the defaults being added.
- **Checksum:** a SHA-256 `checksum` over a canonical (key-sorted)
  serialization.
- **Validation:** `apply`, `verify` and `rollback` refuse a backup unless:
  - the checksum matches;
  - the kind, version and migration match;
  - the project and emulator host match this run's target;
  - each path is `forums/<id>`, listed once;
  - each correction is a default for a field the backup records as missing.
- **No content:** no titles, text, names, emails, UIDs or credentials.
- **Survives restarts:** it is a file, and the progress records below live
  in the emulator database, so no step depends on in-memory state.

**Progress records:** `visibilityRehearsalRuns/{runId}/documents/{forumId}`,
emulator only.
- **Contents:** `migration`, `runId`, `path`, `backupDigest` (the backup's
  checksum), `set` and `state` (`applied` or `restored`).
- **Binding:** a record that doesn't match the verified backup on all of
  these is reported as `foreign_progress_record` and is never treated as
  completed work.

### Apply, resume and rollback

**Atomicity is per document, not per run.** Documents are processed one at
a time. Each one is a single transaction that writes the forum and its
progress record together, or neither.

**Apply.** Inside each transaction:
1. If a matching progress record exists, the document is `alreadyApplied`
   and nothing is written.
2. The forum is re-read with a field mask on the two flags.
3. It is skipped as `deleted` if it is gone.
4. It is skipped as `changed_since_plan` if its update time differs from
   the backup, **or** its flags differ from the backed-up states. Checking
   the update time catches a change that was later undone. Unrelated edits
   since planning also cause a skip, deliberately; re-plan to include them.
5. Otherwise it writes only `set` and creates the progress record.

Changed documents are never re-planned during apply.

**Resume and lost acknowledgements.** A run that stops partway, or whose
commit acknowledgement is lost, is resumed by running `apply` again with
the same backup. Committed documents have a matching record and are
skipped, so nothing is written twice and nothing is left untracked. A
second apply over a finished run writes nothing.

**Rollback ownership.** The progress record is created in the same commit
as the correction, so its server-assigned `createTime` equals the forum's
update time after that commit. Rollback restores a document only if the
forum's update time still equals that `createTime`. The check, the restore
and the record's change to `restored` happen in one transaction. No client
clock is involved.
- A `FieldValue.serverTimestamp()` field is **not** used as the marker. On
  the emulator it resolves to a whole-millisecond value taken before the
  commit, which never equals the commit time. An emulator test pins this.

**Rollback outcomes:**
- `restored`: the added fields are deleted, because their original state
  was missing.
- `alreadyRestored`: the record says `restored`, so nothing is written.
- `notApplied`: there is no record.
- Conflicts, which are skipped and reported, never forced:
  - `deleted`: the forum is gone. It is never recreated.
  - `changed_after_apply`: any write after the correction, **including one
    that restored the same values**.
  - `foreign_progress_record`.
- Repeating rollback is safe. Restored documents stay restored and
  conflicts stay conflicts.

**Limitations:**
- Any later write to a corrected forum blocks its rollback, including an
  unrelated one such as a new comment's `commentCount` increment. This is
  conservative: ownership can't be proven, so the document is reported for
  manual handling.
- Rollback of a partially applied run restores only committed documents.
- Concurrent applies or rollbacks of the same run are serialized per
  document by Firestore transactions, but the run as a whole is not locked.

`verify` is read-only. For each planned document it reports `pending`,
`changed_since_plan`, `deleted`, `applied`, `changed_after_apply`,
`restored`, `changed_after_restore` or `foreign_progress_record`, plus
counts.

### Synthetic fixture and expected counts

The fixture is `scripts/visibility-rehearsal/fixtures/visibility-sample.json`:
12 forums with `PRIVATE-*` content markers that must never appear in a
plan, backup, record or report. The tests apply scripted edits between
steps:
- **after planning:** change `v-changed-after-plan`; change and then undo
  `v-restored-after-plan`; delete `v-deleted-after-plan`;
- **after apply:** change `v-changed-after-apply` and set it back to the
  migrated value; delete `v-deleted-after-apply`.

| Step | Expected (and observed on the emulator) |
| --- | --- |
| Inspected | 12 forums |
| Planned | 8 documents, 13 fields; 3 manual-review items (`v-null` isActive, `v-invalid` both flags) |
| Apply | 5 documents, 8 fields applied; 3 skipped (2 `changed_since_plan`, 1 `deleted`) |
| Second apply | 0 writes; 5 already applied; same 3 skipped |
| Rollback | 3 documents, 4 fields restored; 2 conflicts (`changed_after_apply`, `deleted`); 3 not applied |
| Second rollback | 0 writes; 3 already restored; same 2 conflicts |

These counts describe the fixture only. They say nothing about production.

### Why this is not production readiness

- **Emulator only:** it ran only on the emulator, with synthetic data.
  Production commit-time behavior, IAM, quotas and contention were not
  exercised.
- **No production audit:** none has been authorized, so real counts and
  shapes are unknown.
- **Local backup only:** the backup is a local file holding only the
  touched fields. A production run would also need a managed export
  (safeguard 2) and a tested restore (safeguard 3).
- **Discoverability is unreviewed:** making unlisted forums appear in the
  list needs an explicit product decision.
- **Separate approvals:** production audit, backup, apply and rollback each
  remain separately approved actions (safeguard 9). This tool has no switch
  for them, by design.

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
8. **Rollback:** restore a document only if the migration still owns it,
   not merely if the field still holds the value the migration wrote
   (another actor may have changed it and set it back). The visibility
   rehearsal above uses the progress record's commit time for this.
   Anything else is reported for manual handling.
9. **Explicit approval for each action:** separately for the production
   audit, the backup, each correction category's apply, and any decision on
   manual-review items. Moderation of legacy content, and hiding or
   deleting it, are separate decisions and out of scope here.
