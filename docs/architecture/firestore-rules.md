# Firestore Security Rules and browser authorization (Phases 3A and 3B)

The rules are in `firestore.rules`. They are **not deployed**: the project's
console rules are still deny-all. They are tested only against the local
emulator (`npm run test:rules`, demo project `demo-devtalk`, no credentials).
The repository has no `.firebaserc`, so no Firebase CLI command points at a
real project by default.

Since Phase 3B, browsers only read forums and comments. New forums and
comments are published by the server after moderation (`publishing.md`),
and the rules deny every browser create.

## Access matrix (Verified from the code)

Browser operations come from `app/hooks/useFirestore.ts` and
`app/hooks/forum-data.ts`. The server uses the Admin SDK, which bypasses
rules (`app/api/analyzeMessages.ts`, `app/api/publish.server.ts`).

| Collection | Operation (caller) | Who may | Ownership / protected fields | Query shape |
| --- | --- | --- | --- | --- |
| `forums` | list (`useForums`, forum list page) | signed in; admins may list everything | — | `where isActive == true`, `where isAdminDeleted == false` (required) |
| `forums` | get (`useForum`, `getForum`, forum page) | signed in. Admin-deleted: admins only. Inactive: creator or admin. Otherwise everyone (same as the server's `canViewForum`) | — | single doc |
| `forums` | create | **nobody in the browser.** The server publishes through `POST /api/forums` | — | — |
| `forums` | update (`updateForum`, no UI calls it today) | creator: `isActive` only, not when admin-deleted. Admin: `isActive`, `isAdminDeleted` | Text fields can't change from the browser (that would skip moderation). Ownership, `endTime`, `commentCount`, analysis fields, `moderationPolicy` are never browser-writable | — |
| `forums` | delete (`deleteForum`, no UI calls it today) | admins only | — | — |
| `comments` | list / get (`useComments`) | signed in, if the parent forum is readable | — | `where forumId == <id>` (required) |
| `comments` | create | **nobody in the browser.** The server publishes through `POST /api/comments`, with `commentCount` in the same transaction | — | — |
| `comments` | update | nobody (no edit feature) | — | — |
| `comments` | delete | admins only | — | — |
| `analysisCache`, `analysisState`, `analysisRateLimits`, `publishRequests` | any | nobody in the browser (Admin SDK only) | — | — |
| anything else | any | nobody | — | — |

No other collection is used by the browser. The `Vote` type in
`useFirestore.ts` has no collection or code that writes it.

## Validation

Field validation for new forums and comments moved to the server
(`app/api/publish-request.ts`), with the same limits:

- title 1–200, description 1–2,000, question 1–1,000, comment 1–5,000
  (after trimming);
- a category from the form's list;
- a time limit from the form's options (5 minutes to 1 week).

The rules no longer need them because browsers can't create documents.

## Browser query changes (Phase 3A, unchanged)

- **Forum list:** `useForums()` used to read every forum
  (`orderBy("endTime", "desc")`) and drop inactive and deleted ones in the
  browser. Rules are not filters, so that query can never be allowed
  without exposing hidden forums. `listedForumsQuery()` now asks only for
  `isActive == true` and `isAdminDeleted == false`.
  - Only equality filters are used, so no composite index is needed.
  - The page still sorts by `endTime` itself, so the order is unchanged.
  - Forums without `endTime` are no longer silently left out.
- **Comments:** `where forumId == id` was already the only comment query.
  The rule reads the parent forum through that filter.

## Comments and `commentCount`

- **Phase 3A:** the browser wrote the comment `<forumId>_<n+1>` and the
  forum's `commentCount` in one transaction, and the rules checked that the
  two matched.
- **Phase 3B:** the server does the same write with the Admin SDK, after
  moderation. The rule for it (`commentCountIncrement`) is gone, and no
  browser can change `commentCount` at all. The server transaction re-checks
  that the forum is still open. It is tested against the emulator, including
  concurrent posts and duplicate requests (`publishing.md`).

## Administrator authorization

- **One signal everywhere:** the browser, the server and the rules all use
  the verified `admin: true` custom claim.
- **Removed:** the hardcoded UID in `login.tsx` and `signup.tsx`, and the
  `role` / `admin` sessionStorage flags. Login clears any old flags.
- **Login:** reads the claim from a freshly refreshed token
  (`hasAdminClaim(user, true)`).
- **Dashboard:** follows `onIdTokenChanged`, so a granted or revoked claim
  shows after the next token refresh.
- **Failure handling:** a missing, revoked or non-boolean claim, or a token
  that can't be read, means not admin.
- **Display preference:** the "anonymous" setting stays in sessionStorage. It
  only changes the displayed name. The server stores the caller's verified
  UID as `userId` / `creatorId`.
- **No account has the claim**, and no phase so far has set one.

### Provisioning and revoking an admin (for a later phase, not run)

1. Devyn approves the specific account in writing (UID and email), outside
   the app.
2. From a trusted machine with Application Default Credentials for
   `devtalk-88046` (no service-account key file), run a one-off Admin SDK
   script:
   ```js
   await getAuth().setCustomUserClaims(uid, { admin: true });
   ```
   This replaces all custom claims for that user. Read the existing claims
   first and merge them if any exist.
3. The user signs out and in again, or the client refreshes its token with
   `getIdToken(true)`. Claims reach the token only on refresh, within about
   an hour.
4. **Revoke:**
   ```js
   await getAuth().setCustomUserClaims(uid, { admin: null });
   await getAuth().revokeRefreshTokens(uid);
   ```
   The server verifies tokens with `checkRevoked`, so the old token stops
   working at once. The rules see the claim gone after the next token.
5. Record each grant and revocation (who, when, why) in the project notes.

## Workflows blocked until these rules are deployed

The console rules are deny-all, so in the deployed app today **every
browser Firestore read is denied**:

- **Forum pages:** the forum list, forum pages and comment lists don't load.
- **What's Tea:** the normal UI is blocked too. The button sits on the forum
  page, and the page can't load the forum or its comments. The analysis API
  (`POST /api/analyzeMessages`) itself would work, because it reads with the
  Admin SDK. *(Correction: the Phase 3A version of this page said What's
  Tea "still works". That is only true of the API, not of the UI.)*
- **Creating forums and posting comments:** with this PR these no longer
  depend on the rules. They go through the server, which needs
  `OPENAI_API_KEY` for moderation and Admin SDK credentials. A user can't
  reach the comment box while the forum page is blocked, though.
- **Order of deployment:** deploy the app version from this PR first, then
  the rules. The new rules deny the old browser create paths, so older app
  versions could no longer create forums or comments.

## What stays blocked after deployment (intended)

- Signed-out browsing (as the server requires sign-in for analysis).
- Creating forums or comments directly from the browser, and editing forum
  text, for everyone including admins.
- Comments on closed, inactive or admin-deleted forums (server check).
  Creators can't comment on their own hidden forum.
- Editing comments, and deleting comments or forums, except by admins.
  There is no admin until a claim is provisioned.
- **Legacy-document cases:**
  - Forums missing `isActive` or `isAdminDeleted` don't appear in the list,
    because the query needs both fields. They still open by direct link.
  - Forums with a non-timestamp `endTime` don't accept new comments.
  - Comments without a `forumId` can't be read.

  See `legacy-data.md` for the risks and a proposed migration. Nothing was
  changed.

## Testing

```
npm run test:rules   # starts the Firestore emulator, runs tests/firestore-rules
```

- **Forums:**
  - reads by role, and list queries (allowed and broad);
  - every browser create denied, including the old page's exact document;
  - creator visibility toggles allowed, text edits denied;
  - admin claim vs. a fake `"true"` claim, deletes, and counter changes.
- **Comments:**
  - the old browser transaction, single writes and batches are all denied;
  - spoofed authors are denied;
  - reads follow forum visibility, broad queries are denied;
  - edits are denied, deletes are admin-only.
- **Publishing (Admin SDK against the emulator):**
  - forum and comment creation, readable through the rules;
  - 5 concurrent comments are counted exactly;
  - 4 concurrent duplicates produce 1 comment;
  - a forum closed or deleted during moderation gets no comment;
  - hidden forums stay hidden.
- **Server-only collections:** every operation is denied for signed-out
  users, signed-in users and admins.

CI runs these tests in the `firestore-rules` job (Java 21, emulator jar cached).

## Remaining risks

- **Anonymity is display-only:** comments and forums store the real UID,
  and any signed-in user can read it. Hiding it needs a data-model change.
- **Display names:** these come from the verified token (name, then email)
  and are moderated when shown. An email used as a display name is visible
  to other users, as before.
- **Commenting at scale:** each comment is a transaction on the forum
  document, so very busy forums can see retries. Firestore sustains about 1
  write per second per document.
- **Legacy data** with missing flags, string end times or old counts (see
  `legacy-data.md`).
- **Deployment order** must be app first, then rules.
- **Votes** (`upvotes` / `downvotes`) can't be changed by browsers. No
  voting feature writes them today.
