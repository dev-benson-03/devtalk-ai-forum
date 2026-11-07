# DevTalk Safe-for-Work content policy

**Version:** `sfw-2026-11-06` (`MODERATION_POLICY_VERSION` in
`app/moderation/policy.server.ts`). The code and this page change together,
and every change bumps the version. Each published forum and comment stores
the version it passed as `moderationPolicy`.

DevTalk is a developer forum. People should be able to argue, vent about a
broken build, and discuss hard subjects. They should not have to read sexual
content, slurs, threats or gore.

## What is not allowed

| Reason code (shown to the user) | What it covers | How it is detected |
| --- | --- | --- |
| `sexual` | Explicit sexual content or solicitation. Any sexual content involving minors. | Moderation model: `sexual`, `sexual/minors` flagged |
| `profanity` | Strong profanity and obscene words (the list in `profanity.server.ts`) | Local word check (the model has no profanity category) |
| `hate_harassment` | Hate speech about protected groups. Insults or harassment aimed at a person or group. | Model: `hate`, `harassment` flagged |
| `threat` | Credible threats of violence or serious harm | Model: `hate/threatening`, `harassment/threatening` flagged |
| `graphic_violence` | Gore and graphic descriptions of injury or death | Model: `violence/graphic` flagged; `violence` at score ≥ 0.9 |
| `unsafe` | Other clearly unsafe content: self-harm instructions, help with violent wrongdoing or weapons, high-confidence illicit or self-harm promotion | Model: `self-harm/instructions`, `illicit/violent` flagged; `illicit`, `self-harm` at score ≥ 0.9 |

All publishable text is checked: forum title, description, main question,
comment text, and the display name when the post is not anonymous. The
category comes from a fixed list and isn't checked.

## What stays allowed

- **Ordinary technology talk,** including words that only look rude, like
  "kill the process", "master/slave replication", "fork bomb", "Scunthorpe",
  "assessment" and "class".
- **Neutral educational or clinical terms:** "sex education app", "breast
  cancer screening", "HIV status", "anatomy".
- **Mentioning a prohibited subject without promoting it:** "How do I
  moderate hate speech in my app?", "Our game has a violent boss fight",
  "How do pen-testers use Metasploit?"
- **Constructive disagreement, even blunt:** "This design is wrong and here
  is why", "I strongly disagree with this RFC".
- **Mild language:** damn, hell, crap, sucks, "what the heck".
- **Self-masked words:** "f*ck", "s**t". The writer already censored them.

**The line:** the policy looks at what a text *does*, not which topic it
mentions. Describing, asking about, quoting for discussion, or criticizing
a subject is fine. Sexualizing, insulting, threatening, inciting or giving
harmful instructions is not.

### Synthetic examples

| Text | Decision | Why |
| --- | --- | --- |
| "Which ORM handles migrations best?" | Allowed | Ordinary discussion |
| "Your PR is sloppy, please add tests." | Allowed | Blunt but constructive |
| "This framework sucks, damn it." | Allowed | Mild language |
| "How should a forum detect harassment?" | Allowed | Mentions the subject, doesn't harass |
| "Our health app stores breast cancer screening results." | Allowed | Clinical terms |
| "This build is sh1t." | Rejected: `profanity` | Strong profanity, obfuscated |
| "f u c k this" | Rejected: `profanity` | Spaced-out letters are read as one word |
| "People like you are [slur] and should leave." | Rejected: `hate_harassment` | Targeted hate |
| "I know where you live and I will hurt you." | Rejected: `threat` | Credible threat |
| Explicit sexual description or solicitation | Rejected: `sexual` | Sexual content |

The tests use only synthetic text like this (`app/moderation/__tests__`,
`app/api/__tests__/publish-routes.test.ts`).

## How the decision is made

1. **Strong profanity is checked locally first.**
   - Matching works on whole words, not raw substrings, so "Scunthorpe",
     "Yamashita" and "therapist" are not affected.
   - Before matching, the text is normalized: case, accents and zero-width
     characters are removed, look-alikes are mapped back (`1`→i, `$`→s,
     `@`→a), repeated letters are collapsed, and spaced-out or dotted letters
     are joined.
   - Words whose letters also occur inside ordinary words or names (shit,
     cunt and others) match only as listed forms.
   - Profane text is rejected without calling the provider.
2. **The OpenAI Moderation API** (`omni-moderation-latest`) checks all
   fields in one request, using the existing server-only `OPENAI_API_KEY`.
   The Moderation API is free.
3. **Categories that often fire on legitimate developer talk** (`violence`,
   `illicit`, `self-harm`) reject only at a score of 0.9 or more.
4. **Self-harm intent is not blocked.** `self-harm/intent` stays allowed, so
   that someone saying they are struggling doesn't get a rejection message.
   This is an open question; see the last section.
5. **What the client is told:** one reason code and the field name. Scores,
   provider category names and the text are never returned or logged.

## Failures (fail closed)

If moderation can't run, nothing is published and the user is asked to try
again later (HTTP 503, `moderation_unavailable`). That covers:

- no API key configured;
- a timeout (5 s per request, one SDK retry, 12 s overall limit);
- a provider error;
- a response that is missing results or categories, or whose flags or
  scores have the wrong type.

## False positives

- **What the user sees:** a short, respectful message naming the field and
  the reason. The draft stays in the form, so they can rephrase and
  resubmit.
- **Reporting:** there is no in-app appeal yet. Ask users to report wrongly
  blocked posts to the maintainer (Devyn), with the reason shown and the
  time, not the text.
- **Investigating:** server logs record `[publish]` events with the
  operation, forum ID, reason code, field name and status, never the text.
  A rejection can be found by time and reason code. The text itself is
  never stored when a post is rejected.
- **Fixing:**
  - a profanity-list false positive: change the list in
    `profanity.server.ts`, add the word as a test case, and bump the
    version;
  - a model false positive in a common developer phrase: add a test with a
    synthetic example. Raise a category to the high-score group only if
    needed, and record why here.
- **Reviewing:** review this page whenever the version changes, and at least
  each quarter.

## Open questions for the maintainer

- **Self-harm intent:** should a post that expresses it be allowed, as it is
  now, held for review, or answered with support resources?
- **Mild profanity:** should more words count as strong profanity for
  DevTalk's audience?
- **Existing posts:** posts made before this policy were never moderated.
  See `legacy-data.md`.
