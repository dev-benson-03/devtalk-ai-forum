# Secure publishing (Phase 3B)

New forums and comments are published only by the server, after
authentication, validation and Safe-for-Work moderation. Browsers keep
reading through Firestore, under the rules. Nothing here is deployed.

## Before: browser write paths (audit of `test` at cfff0ec)

| What | Where | How it wrote | Problem |
| --- | --- | --- | --- |
| Create forum | `create-forum.tsx` → `buildForumDocument` → `useFirestore().createForum` | `addDoc(forums)` from the browser | Any text reached Firestore. Rules can check shape, not meaning. |
| Post comment | `forum-detail.tsx` → `useFirestore().createComment` → `createCommentRecord` | Browser transaction: comment `<forumId>_<n+1>` plus `commentCount` | Same problem |
| Edit forum text | `useFirestore().updateForum` (no UI calls it) | `updateDoc`; rules allowed the creator to change title, description, question and tags | Would bypass moderation once publishing moved to the server |
| Hide/delete forum | `updateForum` / `deleteForum` (no UI) | Creator `isActive`; admin flags and delete | No text, so no moderation needed |
| `/messages` page | `MessageService`, `ModerationService` | `fetch('/api/messages')`, `/api/moderation` | Those endpoints don't exist and don't touch Firestore (unused prototype) |

Firestore rules can't judge meaning, so moderation must run on the server
and the browser create paths must be closed.

## After: the publishing flow

```
create-forum.tsx / forum-detail.tsx
  └─ useFirestore().createForum / createComment
       └─ publish-client.ts: POST /api/forums | /api/comments
            (Bearer ID token, JSON body, one requestId per draft)
            └─ publish-route.server.ts
                 1. requireUser: verified token (401 / 503)
                 2. readJsonBody (stream-bounded, 32 KiB) + validate*Request (400 / 413)
                 3. publish.server.ts
                    a. duplicate check: publishRequests/{sha256(uid, requestId)},
                       digest of the submission must match (else 409)
                    b. (comments) forum exists, is visible, accepts comments (404 / 403 / 409)
                    c. admission: publishRateLimits/{uid}, own transaction (429 / 503)
                    d. moderation: profanity check and OpenAI Moderation (422 / 503)
                    e. one Admin SDK transaction: re-check (a) and (b), then
                       create the document + receipt (+ commentCount for comments)
```

### Reading the body

The body is read by `readBoundedText` (`app/api/bounded-body.ts`) before any
JSON parsing:

- **Declared size:** a `Content-Length` above 32 KiB
  (`MAX_PUBLISH_BODY_BYTES`) gets 413 at once, and the body is cancelled
  unread.
- **Actual size:** the stream is read chunk by chunk and its bytes are
  counted. As soon as the count passes 32 KiB the reader is cancelled (web
  streams) or destroyed (Node streams) and the request gets 413. A missing
  or false `Content-Length` doesn't matter. Oversized text is never decoded
  or parsed.
- **Encoding:** the bytes must be valid UTF-8 (`TextDecoder` with
  `fatal: true`). Invalid UTF-8 or JSON gets 400 `invalid_json`; a stream
  that fails mid-read gets 400 `unreadable_body`.
- **Nothing else runs:** after a 400 or 413 there is no moderation call and
  no Firestore access. Authentication runs first, so an unauthenticated
  request is rejected before its body is read.

### Request bodies

Only these keys are accepted. Any other key gets `400 unexpected_field`, for
example `creatorId`, `userId`, `userName`, `isAdmin`, `isActive`,
`commentCount`, analysis fields or timestamps.

- **`POST /api/forums`:** `{ title, description, question, category, timeLimitHours, anonymous, requestId }`
  - Text is trimmed and must not be blank.
  - Length limits: title 200, description 2,000, question 1,000
    (`app/forum/forum-options.ts`).
  - `category` must be one of the form's 9 categories.
  - `timeLimitHours` must be one of the form's 10 options.
- **`POST /api/comments`:** `{ forumId, content, anonymous, requestId }`
  - `content` is 1 to 5,000 characters after trimming.
- **Both:** `anonymous` is a boolean, and `requestId` is a UUID.

### What the server sets

- **Author:** `creatorId` / `userId` is always the verified token's UID.
- **Display name:** the token's `name`, then `email`, then "User", cut to 256
  characters. With `anonymous: true` it is "Anonymous User". Anonymity is a
  display choice, never authorization: the UID is still stored.
- **Forum fields:** `isActive: true`, `isAdminDeleted: false`,
  `commentCount: 0`, `endTime` (now + the chosen time limit), `createdAt`
  (server time), empty analysis fields as before, and `moderationPolicy`.
- **Comment fields:** `createdAt` (server time), `upvotes: 0`,
  `downvotes: 0`, `moderationPolicy`. Comments now get random Firestore IDs.
  The `<forumId>_<n>` IDs were only needed by the browser rules.

### Comments and `commentCount`

- **No transaction during moderation:** moderation runs before the
  transaction, so no transaction is held open across the OpenAI call.
- **Re-check inside the transaction:** the transaction reads the forum
  again and re-checks that it still exists, is visible and accepts
  comments: active, not admin-deleted, and before `endTime`. A forum closed
  or deleted while moderation ran gets no comment.
- **Atomic count:** the comment and `commentCount` (read value + 1) are
  written in the same transaction. Firestore retries contended
  transactions, so concurrent comments are counted exactly. The emulator
  test runs 5 at once.
- **Legacy forums:** forums without `commentCount` start at 1, and forums
  without `endTime` stay open, as on the forum page. A string `endTime`
  counts as closed, as in the rules.

### Duplicate requests

- **One ID per draft:** the page keeps a `requestId` for each draft. A
  retry, a double submit, or a resend after a lost response uses the same
  ID. The ID is replaced only after a successful post.
- **Receipts:** a successful publish writes a receipt
  `publishRequests/{sha256(uid + requestId)}` (`uid`, `kind`, `targetId`,
  `digest`, `expiresAt`) in the same transaction as the document.
- **Digest:** `digest` is the SHA-256 of a JSON array (a fixed, ordered
  encoding) of a version tag, the operation, the verified UID and the
  validated fields (`forumDigest` and `commentDigest` in `publish.server.ts`):
  - forum: title, description, question, category, timeLimitHours, anonymous;
  - comment: forumId, content, anonymous.

  The text is trimmed by validation first, so whitespace changes don't count.
  The receipt stores only the hash, never the text.
- **Repeats:** a repeat with the same digest finds the receipt and returns the
  original ID with `duplicate: true` (HTTP 200). Nothing is written twice. The
  emulator test sends 4 concurrent requests with one ID and gets 1 comment and
  a count of 1.
- **Changed submission:** the same `requestId` with any different field, a
  different user or a different operation gets 409 `request_reused`, before
  moderation and with no write. The page then starts a new `requestId` for the
  draft, so pressing Send again publishes the edited text.
- **Checked twice:** the digest is compared before moderation and again inside
  the transaction, so two different submissions racing with one ID publish
  exactly one (emulator tests).
- **No receipt on failure:** a rejected or failed submission writes no
  receipt, so the same draft can be fixed and resent with the same ID.

### Publishing limits

Each verified user has a publishing allowance (`app/api/publish-limits.server.ts`),
checked after authentication, validation, the receipt check and (comments)
the forum checks, and before moderation. Starting values, not measured
thresholds:

| Window | Limit per user |
| --- | --- |
| New forums | 5 per hour |
| New comments | 30 per 10 minutes |
| Forums and comments together | 200 per UTC day (resets at 00:00:00 UTC) |

- **Algorithm:** fixed windows. The forum and comment windows start at the
  first admitted attempt and reset once their time has passed. The daily
  window is the UTC calendar day: it resets at 00:00:00 UTC (the last moment
  of a day is 23:59:59.999). UTC avoids time zones and daylight saving; for
  U.S. users the reset falls in the evening local time.
- **Date handling:** all times are integer milliseconds since 1970 in UTC and
  are stored as Firestore Timestamps. There are no two-digit years, date
  strings or local-time conversions. Tests cover the 2000 rollover, a leap day,
  the 2038 32-bit limit and 2100 (not a leap year). A clock outside the range
  Firestore can store (after the year 9999) gives a 503, not a crash. The forum and comment windows
  are independent, so hitting the forum limit doesn't stop someone replying.
  The daily window caps one account at 200 admitted attempts a day. That is
  not a guarantee of 200 provider calls: the moderation SDK retries a failed
  request, so one attempt can make more than one call. At a window boundary a user can briefly get up to twice a short
  limit; that is accepted for simplicity.
- **Storage:** `publishRateLimits/{uid}` holds only
  `{ forums, comments, daily: { start, count }, expireAt }`. `expireAt` is
  the latest end of every window the document holds, including the one the
  current attempt didn't touch, because a short window can run past the end
  of the daily one. No text, email,
  token, score or support flag. Browsers can't read or write it (rules).
- **Atomic:** the check and the count happen in one Firestore transaction
  with no external call inside it, so concurrent requests can't exceed the
  limit (emulator tests). It is separate from the final write transaction.
- **What counts:** every admitted attempt, including ones moderation
  rejects, ones that fail because moderation is down, and ones whose final
  write fails. Otherwise rejected content could be resent without limit.
- **What doesn't count:** unauthenticated or malformed requests, a completed
  identical retry (it returns the original ID from the receipt), a changed
  submission under a used ID (409), and comments refused by the forum checks.
  Concurrent new requests with the same ID that have no receipt yet may each
  count and each be moderated; only one is published.
- **Clocks:** a window that starts slightly after this request's clock
  (another instance's clock or a request that read it later) is treated as
  current, not expired. The emulator showed that resetting it lost counts.
- **Contention:** if many requests from one user collide, a transaction can
  give up (Firestore `ABORTED`). That returns 503, never an admission.
- **Separate from AI analysis:** these limits don't touch
  `analysisRateLimits` and vice versa.

Database operations for a new submission: 1 receipt read, 1 forum read
(comments), the admission transaction (1 read, 1 write), then the existing
write transaction. A completed duplicate costs 1 read. A refused one costs
the receipt read, the forum read (comments) and 1 read in the admission
transaction.

## How bypass attempts are prevented

| Attempt | Blocked by |
| --- | --- |
| Write a forum or comment straight to Firestore (old SDK path, batch, `addDoc`, `setDoc`) | Rules: `allow create: if false` on `forums` and `comments` (emulator tests) |
| Edit a forum's text from the browser after publishing | Rules: the creator may change only `isActive`; admins only `isActive` and `isAdminDeleted` |
| Change `commentCount`, ownership, analysis fields or `moderationPolicy` | Rules: no update path allows them (tests) |
| Post as someone else or as an admin | The server takes the UID from the verified token, and unknown body keys get a 400 |
| Skip moderation through the API | The endpoints always moderate before writing. The Admin SDK bypasses rules, so the endpoints validate everything themselves |
| Moderation outage | Fail closed: 503 and no write |
| Flood moderation with submissions, or resend rejected content | Per-user publishing limits, counted before moderation (429) |
| Read or reset one's own allowance | Rules: `publishRateLimits` is denied to every browser, admins included (tests) |
| Read the publish receipts | Rules: `publishRequests` is denied to every browser (tests) |
| Comment on a closed or hidden forum | Server checks before moderation and again inside the transaction |
| Steer What's Tea with a comment | See `ai-analysis.md`: the prompt treats forum text as quoted data, and the output is validated |

## Responses and user experience

| Case | HTTP | Body | What the page does |
| --- | --- | --- | --- |
| Published | 201 (repeat: 200) | `{ id, duplicate, support? }` | Forum: goes to `/forums`. Comment: clears the box. With `support: true`, the author first sees the support message (`content-policy.md`). |
| Not allowed | 422 | `{ error, reason, field, support? }` | Alert: "Your *field* doesn't meet DevTalk's community guidelines (*reason*). Please revise it and try again." With `support: true` the support message follows. The draft stays. |
| Reused request ID | 409 | `{ reason: "request_reused" }` | Generic failure alert; the draft gets a new ID, so sending again works |
| Moderation down | 503 + `Retry-After: 30` | `{ reason: "moderation_unavailable" }` | Alert: "Publishing is temporarily unavailable. Your draft is still here, so you can try again in a moment." The button is enabled again. |
| Storage down | 503 + `Retry-After: 5` | `{ reason: "storage_unavailable" }` | Same as above |
| Over the publishing limit | 429 + `Retry-After: n` | `{ reason: "rate_limited", retryAfterSeconds: n }` | Alert: "You're posting faster than DevTalk allows. Your draft is still here, so please try again in about *n minutes*." The draft and its request ID stay. |
| Limit storage down | 503 + `Retry-After: 30` | `{ reason: "rate_limit_unavailable" }` | Same as "Moderation down" |
| Forum closed | 409 | `{ reason: "forum_closed" }` | Alert: the forum has closed. The draft stays. |
| Hidden or deleted forum | 403 | `{ error }` | Generic failure alert |
| Signed out or expired token | 401 | `{ error }` | One retry with a fresh token, then "Please sign in again to post." |
| Bad input | 400 / 413 | `{ reason, field? }` | Generic failure alert (the form prevents this) |

- **No redesign:** pages use the same `alert()` they used before for
  errors, with clearer wording.
- **Unchanged UI:** the forum page, buttons, theme and What's Tea modal
  are unchanged.
- **Retries are manual:** the user sends again when ready, and the page
  does not retry automatically.

## Logging

- **Server** (`[publish]`): event name, forum ID, published ID, status,
  reason code, field name, error code, `retryAfterSeconds` (rate limits)
  and duration. The UID is not logged.
- **Never logged:** submitted text, display names, emails, tokens or
  moderation scores. The route tests assert this.
- **Browser** (`useFirestore`, login, signup): operation, IDs, counts,
  duration and an error code from `errorCode()`.

## Deployment prerequisites (for a later phase)

1. **API key:** set `OPENAI_API_KEY` on the server. Without it every
   publish fails closed (503).
2. **Admin SDK credentials:** these must be configured (Phase 1). The
   endpoints use the Admin SDK.
3. **Order of deployment:** deploy this app version first, then the rules.
   The new rules deny the old browser create paths. Until the rules are
   deployed, the console's deny-all rules still block all browser reads,
   so forum pages stay blocked.
4. **Cleanup (optional):** Firestore TTL policies on
   `publishRequests.expiresAt` (7 days) and `publishRateLimits.expireAt`
   (the latest end of the user's stored windows). They need no new
   infrastructure, but each TTL deletion is a billable Firestore delete
   operation. Without them, each limit document stays (one small
   document per user who has posted); a stale one is simply treated as
   expired. Not configured here.
5. **Index:** no composite index is needed. The publish code reads by
   document ID only.

## Not tested

- **The real Moderation API:** its decisions on real text were not tested
  (no live calls). The provider's response shape matches the openai
  6.6.0 SDK types and is validated at runtime.
- **Production Firestore:** contention behavior was tested only in the
  emulator, including the publishing limits.
- **Limit values:** chosen as starting points for a small forum, not
  measured against real traffic.
- **Browser smoke test:** none was run in a real browser against a deployed
  server.
