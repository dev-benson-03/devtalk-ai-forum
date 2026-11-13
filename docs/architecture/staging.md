# Staging (`devtalk-staging`) for Vercel Previews

Production stays on `devtalk-88046`. Vercel Preview deployments use the
separate Firebase project `devtalk-staging`, holding synthetic data only.

## Project and configuration isolation

`app/firebase/projects.ts` maps production → `devtalk-88046` and
staging → `devtalk-staging`. A deployment declares its environment with
`DEVTALK_FIREBASE_ENV` (`production` | `staging`) and/or Vercel's
`VERCEL_ENV`; when both are set they must agree. See server-auth.md for
the Admin-side checks.

For the browser, `app/firebase/web-config-bindings.ts` records, per
environment, a pinned SHA-256 fingerprint of the web API key plus the public
app ID, sender ID, auth domain, bucket and project from the Firebase console,
reviewed in code. A build that declares an environment must supply an API
key whose SHA-256 equals the pinned fingerprint and exactly those public
values; anything else (for example a production API key with
otherwise-staging settings) fails the build. The fingerprint is never
derived from the variable being checked, and the key itself is never stored
in the repository. A binding left `null`, or a missing or malformed
fingerprint, refuses every build for that environment. Never record a
secret there.

### Computing an API key fingerprint (owner, outside any session)

Copy the web API key from the Firebase console (Project settings > General >
Your apps > the web app > Config, `apiKey`), then in a terminal run `bash`
(macOS's default shell is zsh; this line was tested in bash) and:

```
read -rs KEY; printf '%s' "$KEY" | shasum -a 256 | cut -d' ' -f1; unset KEY
```

On Linux, use `sha256sum` instead of `shasum -a 256`. Paste the key at the
blank prompt and press Enter. The key is typed into `read`, never part of a
command line, so it is not saved in shell history or visible in any process's
arguments (`read` and `printf` are shell builtins); `-s` keeps it from being
echoed, and `unset` removes it from the shell afterwards. The output is 64
lowercase hex characters: record only that, as `apiKeySha256`. Use exactly
the value you will enter in Vercel; leading and trailing spaces are ignored
both here and by the build check. Clear the clipboard afterwards.

## Synthetic seed (`scripts/staging-seed/`)

`planSeed` (dataset.ts) defines 3 accounts (`seed-*@example.test`, display
name only, no claims), 8 forums (open, no end time, expired, hidden,
admin-deleted, and legacy string/null/number end times), 9 comments
(including string, number and missing dates) and 1 cached analysis whose
text is prefixed `[Synthetic seed data, not AI-generated]`, keyed so the
server's own lookup serves it for the open forum.

- **Documents** carry `seed: "staging-seed-v1"` and a `seed-v1-` ID.
- **Ledger:** `stagingSeed/staging-seed-v1` names the seed, the target
  (`kind`, `projectId`) and a digest of the plan. For each account the seed
  creates it records the email, the id of the credentials file that holds
  its password (never the password), and a state: `pending` (written before
  `createUser`) or `created` with the account's `creationTime` (written
  after). A ledger for another seed, target or plan, or with any entry that
  does not match the plan, makes apply and cleanup stop before changing
  anything.
- **Account ownership:** an account is the seed's only if its uid and
  email match the plan *and* its ledger entry is `created` with the same
  `creationTime`. An account with no entry, or one deleted and recreated
  later (a different `creationTime`), is **foreign**: apply refuses and
  cleanup leaves it alone. An existing account with a `pending` entry is
  **uncertain** (see recovery below). The seed never changes an existing
  account's password or claims.
- **apply** checks everything first and refuses before any write if a
  planned document lacks the marker, or an account is foreign or uncertain.
  It then creates what is missing (`create()` only), one account at a time:
  save the password, ledger `pending`, `createUser`, ledger `created`, mark
  the password `created`. Re-running is idempotent.
- **verify** is read-only and reports missing, seeded, foreign and
  uncertain records.
- **cleanup** deletes only planned documents that still carry the marker
  and planned accounts the ledger proves the seed created. Paths and uids
  that appear only in the ledger are never acted on. The ledger is removed
  only when nothing was skipped.
- **Targets** (target.ts): the emulators (loopback hosts, `demo-*`), or
  exactly `devtalk-staging` with `--confirm devtalk-staging`,
  `DEVTALK_FIREBASE_ENV=staging`, no emulator hosts, and nothing in the
  environment naming `devtalk-88046`.

### Credentials file (`--credentials-out`)

apply needs `--credentials-out <file>`. Before connecting to anything, the
CLI takes the file's writer lock and creates the file exclusively (it never
overwrites) with mode 0600. It refuses a path inside the repository, a
missing directory, an existing file, or a file another apply holds. Each
new password is saved before its account is created; a failed save stops
apply before that account. Passwords never go to Firestore, stdout, errors
or reports; the report gives only counts (`created`, `pending`,
`generatedThisRun`), the path and the file id.

**Complete writes.** Every write goes to a new temporary file in the same
directory. The data is UTF-8 encoded and written in a loop that advances by
the number of bytes each write reports, and fails if a write makes no
progress; then the file is flushed. Only then is it moved into place: a new
file with `link()` (which never replaces an existing file) and an update
with `rename()`, followed by a flush of the directory. Any failure removes
the temporary file and leaves the previous file byte-for-byte as it was,
so a partial file can never replace a good one, and an incomplete new file
never appears (apply stops before connecting).

```
{ "format": "devtalk-staging-seed-credentials", "version": 1, "fileId": "<32 hex>",
  "seed": "staging-seed-v1", "target": { "kind": "...", "projectId": "..." }, "planDigest": "<sha256>",
  "accounts": { "<uid>": { "email", "password", "status": "pending|created", "runId", "savedAt" } } }
```

`--resume` reopens an existing file instead. It must be a regular file
(not a symlink, and with no other hard links) owned by you with mode 0600,
written for the same seed, target and plan, with entries only for planned
accounts. Saved passwords are reused, never regenerated.

### One writer per credentials file

`<file>.lock`, next to the credentials file, says which apply is using it:
`{ format, token, pid, host, startedAt }` (no passwords). apply creates it
with `O_EXCL` (atomic: it fails if any lock exists) before creating or
reading the credentials file, on the file's canonical path (real directory
plus file name), so another path to the same directory finds the same
lock. While it exists, every other apply on that file, new or `--resume`,
is refused before connecting to Firebase.

The lock is held until apply exits and is released on success, on any
error (including a failed SDK start or a refused resume), and on SIGINT or
SIGTERM. A session removes the lock only if it still carries its own
random token, so it never removes another session's lock. Before each
save, the session also checks that it still holds the lock and that the
file is exactly what it last wrote; otherwise it stops.

### Recovering a lock left by a killed apply

SIGKILL, a crash or a power loss leaves the lock behind, and apply then
reports `in use by process <pid> on <host> since <time>`. Age alone never
releases a lock. To recover:

1. Make sure no apply is running with that file (for example, the
   terminal that ran it is closed, or `ps -p <pid>` shows nothing or an
   unrelated program).
2. Re-run with `--resume --recover-stale-lock`. It removes the lock only if
   the lock is readable, was written on this host, and its process no
   longer exists. It refuses if the process is still running (even if the
   PID has since been reused by another program: it then cannot tell, and
   stays safe), if the lock is from another host, if the process's state
   cannot be checked, or if the lock is unreadable (for example, the crash
   happened while the lock was being written).
3. If it refuses and you are sure no apply is using the file, delete
   `<file>.lock` by hand and re-run with `--resume`. Nothing in the lock is
   secret, so it can be read with `cat`; the credentials file never needs
   to be opened to diagnose a lock.

Leftover `.<file>.<pid>.<hex>.tmp` files from a killed run hold at most
copies of saved passwords; delete them with the credentials file when it
is no longer needed.

### Recovering an interrupted apply

If apply stops, the error says where the saved passwords are. Fix the
cause and re-run the same command with `--resume` and the same
`--credentials-out`. Accounts and documents already created are kept,
missing ones are created with the passwords already saved, and the
credentials file is brought up to date.

If apply reports an account as **uncertain**, an earlier run saved its
password and called `createUser`, but never confirmed the result (for
example, the reply was lost, or the ledger write after it failed). The seed
will not adopt or delete it. To resolve it:

1. Run `verify` to list the uncertain accounts.
2. In the Firebase console (Authentication), check that the account has
   the planned uid and `seed-*@example.test` email, and was created at
   about the `savedAt` time of its entry in the credentials file named by
   the ledger's `credentialsId`. If anything doesn't match, stop: it may
   not be the seed's.
3. Delete that account in the console.
4. Re-run apply with `--resume`. The account is created again with the
   same saved password and confirmed in the ledger.

### Limits

Firebase Auth and Firestore share no transaction, so these gaps remain and
are handled by refusing, not by promising atomicity:

- Between `createUser` and the ledger update, a crash leaves an uncertain
  account. It is never deleted automatically.
- `creationTime` has one-second resolution. An account deleted and
  recreated with the same uid and email within the same second as the
  seed's original would look like the seed's.
- Auth has no conditional delete. If an account were replaced between
  cleanup's ownership check and its `deleteUser` call (one request), the
  replacement would be deleted.
- If the credentials file is lost, the accounts still work but their
  passwords cannot be recovered; reset them in the console or run cleanup
  and apply again with a new file.
- The lock covers one credentials file, not the staging project. Two
  applies with *different* credentials files are not serialized by it.
  They are kept apart by the ledger instead: only one can create the
  ledger, an account's ledger entry can move to `pending` only from
  nothing or from the same file's entry, and to `created` only from the
  same file's `pending`. A run that meets another file's entry stops
  (before any write, if it sees it at preflight), and an account caught in
  between is left uncertain, never adopted. verify and cleanup take no
  lock; don't run cleanup while an apply is running.
- The lock is advisory and local: it relies on `O_EXCL` file creation,
  which network file systems may not honor. Keep the credentials file on a
  local disk.

Tests: `scripts/staging-seed/__tests__` (data, cache-key parity with the
server, target refusals, the credentials file, CLI refusals) and
`tests/firestore-rules/staging-seed.test.ts` (apply, re-apply, sign-in,
rules, cache lookup, conflicts, ownership, interrupted runs and recovery,
cleanup, on the Auth and Firestore emulators; `npm run test:rules` starts
both).

Emulator rehearsal:

```
npx firebase emulators:exec --only firestore,auth --project demo-devtalk \
  "node scripts/staging-seed/cli.mjs apply --target emulator --project demo-devtalk --credentials-out /tmp/seed-creds.json"
```

Add `--resume` to continue with an existing credentials file.

Running against `devtalk-staging`, and deploying `firestore.rules` there,
each need explicit approval.
