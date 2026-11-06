# Firestore Security Rules and browser authorization (Phase 3A)

The rules are in `firestore.rules`. They are **not deployed**: the project's
console rules are still deny-all. They are tested only against the local
emulator (`npm run test:rules`, demo project `demo-devtalk`, no credentials).
The repository has no `.firebaserc`, so no Firebase CLI command points at a
real project by default.

## Access matrix (Verified from the code)

Browser operations come from `app/hooks/useFirestore.ts` and
`app/hooks/forum-data.ts`. The server uses the Admin SDK, which bypasses
rules (`app/api/analyzeMessages.ts`).

| Collection | Operation (caller) | Who may | Ownership / protected fields | Query shape |
| --- | --- | --- | --- | --- |
| `forums` | list (`useForums`, forum list page) | signed in; admins may list everything | — | `where isActive == true`, `where isAdminDeleted == false` (required) |
| `forums` | get (`useForum`, `getForum`, forum page) | signed in. Admin-deleted: admins only. Inactive: creator or admin. Otherwise everyone (same as the server's `canViewForum`) | — | single doc |
| `forums` | create (`createForum`, create-forum page) | signed in, `creatorId == auth.uid` | `isActive: true`, `isAdminDeleted: false`, analysis fields empty, no `commentCount` or votes | — |
| `forums` | update `commentCount` (`createComment`) | signed in, only +1 together with the new comment `<forumId>_<n>` | nothing else may change | — |
| `forums` | update (`updateForum`, no UI calls it today) | creator: `title`, `description`, `question`, `tags`, `isActive` (not when admin-deleted). Admin: `isActive`, `isAdminDeleted` | `creatorId`, `creatorName`, `endTime`, `commentCount`, `summary`, `analysisSummary`, `actionRoadmap`, `lastAnalyzedAt`, `messages` are never browser-writable | — |
| `forums` | delete (`deleteForum`, no UI calls it today) | admins only | — | — |
| `comments` | list / get (`useComments`) | signed in, if the parent forum is readable | — | `where forumId == <id>` (required) |
| `comments` | create (`createComment`) | signed in, `userId == auth.uid`, forum active, not deleted, before `endTime` | `createdAt == request.time`, `upvotes == 0`, `downvotes == 0`, ID `<forumId>_<n>` | transaction with the forum's `commentCount` |
| `comments` | update | nobody (no edit feature) | — | — |
| `comments` | delete | admins only | — | — |
| `analysisCache`, `analysisState`, `analysisRateLimits` | any | nobody in the browser (Admin SDK only) | — | — |
| anything else | any | nobody | — | — |

No other collection is used by the browser. The `Vote` type in
`useFirestore.ts` has no collection or code that writes it.

## Validation

- **Forum create:** only the create-forum page's fields.
  - `title` 1–200 characters.
  - `description` 1–2,000.
  - `question` 1–1,000.
  - `creatorName` 1–256 (an email can be the display name).
  - `tags`: at most 1, ≤ 50 characters.
  - `endTime`: a timestamp after now and at most 8 days ahead (the form's maximum is 1 week).
  - `messages`, `summary`, `actionRoadmap` empty or `[""]`, as the form sends them.
- **Comment create:** exactly `forumId`, `userId`, `userName` (1–256), `content` (1–5,000, not blank), `createdAt` (server time), `upvotes: 0`, `downvotes: 0`. The comment box now has `maxLength={5000}`.

## Browser query changes

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

## Comment workflow and `commentCount`

`createComment()` used to add the comment and then run
`updateDoc(forum, { commentCount: increment(1) })` as a separate write. That
needs either a rule letting anyone change the counter, or losing the
counter. Instead:

- `createCommentRecord()` runs one transaction. It reads the forum's
  `commentCount` (n), creates the comment with ID `<forumId>_<n+1>`, and sets
  `commentCount` to n+1.
- The **comment rule** requires the ID to match the forum's count + 1 and the
  forum's count after the transaction to be exactly +1.
- The **forum rule** allows a `commentCount`-only change of +1 only if
  `<forumId>_<n+1>` did not exist before and exists after the write. That
  comment's own rule checks the author, the forum state and the content.
- So each +1 has exactly one new, valid comment, and the counter can't be
  inflated or reset.
- If two people comment at the same moment, Firestore can reject the later
  transaction as permission-denied, because that comment number is already
  taken. The client then re-reads the count and tries again, up to 3
  attempts in total. A denial for any other reason, such as a closed forum,
  is not retried.
- Existing comments keep their random IDs and stay readable. Legacy forums
  without `commentCount` start at 1.

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
  only changes the displayed name; the stored `userId` / `creatorId` is
  always the caller's UID.
- **No account has the claim**, and this phase sets none.

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

The console rules are deny-all, so in the deployed app today:

- **Blocked:** the forum list, forum pages, comment lists, creating forums
  and posting comments.
- **Still works:** What's Tea, which uses the server's Admin SDK.
- **Order of deployment:** these rules need the new app code. Deploy the app
  version from this PR first, then the rules. With the new rules, the old
  forum list query and the old two-step comment write would be denied.

## What stays blocked after deployment (intended)

- Signed-out browsing (as the server requires sign-in for analysis).
- Comments on closed, inactive or admin-deleted forums. Creators can't
  comment on their own hidden forum.
- Editing comments, and deleting comments or forums, except by admins.
  There is no admin until a claim is provisioned.
- **Legacy-document cases:**
  - Forums missing `isActive` or `isAdminDeleted` don't appear in the list,
    because the query needs both fields. They still open by direct link.
  - Forums with a non-timestamp `endTime` don't accept new comments.
  - Comments without a `forumId` can't be read.

  Existing documents were not inspected or changed. Fixing these cases needs
  a reviewed backfill.

## Testing

```
npm run test:rules   # starts the Firestore emulator, runs tests/firestore-rules
```

- **Forums:** reads by role, list queries (allowed and broad), creation by
  the app's builder and with forged fields, ownership, creator edits, admin
  claim vs. a fake `"true"` claim, deletes, and bare counter increments.
- **Comments:** the app's own transaction, the anonymous display name,
  concurrent posts, a legacy forum, UID spoofing, signed-out users,
  closed/inactive/deleted forums, a missing forum, increments that don't
  match, forged fields, reads by forum visibility, broad queries, edits and
  deletes.
- **AI collections:** every operation denied for signed-out users, signed-in
  users and admins.

CI runs these tests in the `firestore-rules` job (Java 21, emulator jar cached).

## Remaining risks

- **Anonymity is display-only:** comments and forums store the real UID,
  and any signed-in user can read it. Hiding it needs a data-model change.
- **Display names are not verified:** `userName` and `creatorName` are free
  text, so someone can show another person's name, though never their UID.
- **Commenting at scale:** each comment is a transaction on the forum
  document, so very busy forums can see retries. Firestore sustains about 1
  write per second per document.
- **Legacy data** with missing flags or string end times (see above).
- **Deployment order** must be app first, then rules.
- **Votes** (`upvotes` / `downvotes`) can't be changed by browsers. No
  voting feature writes them today.
