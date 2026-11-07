# Legacy data: risks and a migration plan (proposal, not run)

The 43 Firestore documents migrated to `devtalk-88046` were **not read,
changed, moderated or backfilled** in Phase 3B. This page is based on the
code, the Phase 3A rules tests and the migration notes. The actual counts
have to come from the dry run proposed below.

## Findings

| # | Issue | Cause | Effect today (code on `test` + this PR) |
| --- | --- | --- | --- |
| 1 | `commentCount` drift | Before Phase 3A the comment and the `increment(1)` were two separate writes, so a failure between them lost a count. An admin comment delete (rules allow it) doesn't decrement. | The forum list and forum page show "N responses" from `commentCount`, so the number can be wrong. Publishing is unaffected: the server reads the stored count and adds 1. What's Tea counts real comments itself. |
| 2 | Forums missing `isActive` / `isAdminDeleted` | Created before those fields existed | Not in the forum list: the list query needs both fields, and rules are not filters. Still opens by direct link. The server treats missing flags as active and not deleted, so they still accept comments. |
| 3 | Comment IDs | Old comments have random IDs. Phase 3A browser comments used `<forumId>_<n>`. | **No longer a risk.** The server publishes with random IDs and never needs the old scheme. Reads use `where forumId ==` and don't depend on the ID. |
| 4 | `endTime` values that aren't Timestamps (e.g. ISO strings), or missing | Older client code | String `endTime`: the server and the old rules treat the forum as closed, and `forum-detail.tsx` / `forumspage.tsx` call `endTime.toDate()`, which throws on a string (existing bug). Missing `endTime`: the forum stays open. |
| 5 | Content never moderated | Published before this policy | Shown to everyone and fed to What's Tea. New posts are moderated; old ones are not. |
| 6 | Comments without `forumId` | Unknown older shape | The rules can't authorize reading them (the read rule needs the parent forum), so they never appear. |

## Proposed migration (needs Devyn's approval before any run)

One script, for example `scripts/legacy-data.ts`, run from a trusted machine
with Application Default Credentials for `devtalk-88046`. Its properties:

- **Dry run by default.** `--apply` is required to write anything. A dry
  run reads only and prints counts plus document IDs per finding, never
  content.
- **Backup first.** Before `--apply`, the script writes a JSON snapshot of
  every document it might change to a local file outside the repo, with ID,
  path and full data. It refuses to continue if that fails. A restore mode
  writes the snapshot back. Optionally run a managed export
  (`gcloud firestore export`) as well. It is billed and needs a bucket, so
  it needs approval.
- **Idempotent.** Each step changes a document only if it is still in the
  old state, so a second run changes nothing.
- **Small batches** (≤ 100 writes) with a summary per step.
- **Tests:** unit tests against the Firestore emulator with seeded legacy
  shapes, plus a test that a second `--apply` reports 0 changes.

Steps:

1. **Visibility flags (finding 2):** set `isActive: true` only where the
   field is missing, and `isAdminDeleted: false` only where it is missing.
   Missing already means "visible", so behavior is unchanged except that
   the forum appears in the list.
2. **endTime (finding 4):** convert a string that parses as a date to a
   Timestamp. Report anything unparseable and leave it as it is.
3. **commentCount (finding 1):** count the comments where
   `forumId == <id>`. Write `commentCount` only if it differs. Run it again
   after any admin comment deletions. Alternatively, have admin deletes go
   through a server endpoint that decrements in the same transaction (a
   later phase).
4. **Moderation review (finding 5):**
   - Run every existing forum and comment through the same moderator.
   - **Dry run:** report the ID, field and reason code only.
   - **Apply:** stamp passing documents with
     `moderationPolicy: "<version>-legacy"`.
   - For flagged documents, write nothing automatically. Devyn decides per
     item whether to hide the forum (`isActive: false`), soft-delete it
     (`isAdminDeleted: true`) or delete the comment. Nothing is deleted
     without that decision.
5. **Orphan comments (finding 6):** report only.

**Expected counts:** unknown until the dry run. The upper bound is the 43
migrated documents, which include forums, comments and analysis cache
entries.

**Approval needed for:** running the dry run (reads production), running
`--apply`, and each action on flagged content.
