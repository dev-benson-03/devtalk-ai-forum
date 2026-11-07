# DevTalk Safe-for-Work content policy

**Version:** `sfw-2026-11-07` (`MODERATION_POLICY_VERSION` in
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
| `self_harm` | Self-harm or suicide methods and instructions; content that encourages, promotes or glorifies self-harm; graphic depiction meant to encourage it | Model: the three self-harm categories together (see [Self-harm](#self-harm)) |
| `unsafe` | Other clearly unsafe content: help with violent wrongdoing or weapons, high-confidence illicit content | Model: `illicit/violent` flagged; `illicit` at score ≥ 0.9 |

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

1. **Strong profanity is checked locally.**
   - Matching works on whole words, not raw substrings, so "Scunthorpe",
     "Yamashita" and "therapist" are not affected.
   - Before matching, the text is normalized: case, accents and zero-width
     characters are removed, look-alikes are mapped back (`1`→i, `$`→s,
     `@`→a), repeated letters are collapsed, and spaced-out or dotted letters
     are joined.
   - Words whose letters also occur inside ordinary words or names (shit,
     cunt and others) match only as listed forms.
   - The provider still runs on profane text, so a profane post that also
     discloses distress gets the support message. If the provider is down,
     profane text is still rejected (nothing is published either way).
2. **The OpenAI Moderation API** (`omni-moderation-latest`) checks all
   fields in one request, using the existing server-only `OPENAI_API_KEY`.
   The Moderation API is free.
3. **Categories that often fire on legitimate developer talk** (`violence`,
   `illicit`) reject only at a score of 0.9 or more.
4. **Self-harm** is decided from its three categories together; see the next
   section.
5. **Several reasons:** when more than one applies, the first in this order
   is reported: `threat`, `self_harm`, `sexual`, `hate_harassment`,
   `graphic_violence`, `unsafe`, `profanity`. The field named is the one that
   carries that reason. Every other rule still applies: allowing a
   disclosure never overrides a rejection for another reason.
6. **What the client is told:** one reason code, the field name and, for
   the author only, whether to show the support message. Scores, provider
   category names and the text are never returned or logged.

## Self-harm

### What DevTalk allows and blocks

| Allowed | Blocked (`self_harm`) |
| --- | --- |
| Saying you are struggling, or having thoughts of self-harm or suicide | Methods, instructions or "how to" details, including how to hide self-harm |
| Non-graphic discussion of mental health | Encouraging, promoting or glorifying self-harm or suicide |
| Asking for support | Self-harm "challenges", dares or pressure on someone to hurt themselves (usually also flagged as `threat` or `hate_harassment`) |
| Educational, preventive and clinical discussion (crisis-line apps, research, recovery resources) | Graphic descriptions meant to encourage harm |
| Talking with empathy about someone else's experience or your own recovery | |

### How overlapping categories are resolved

The provider returns three related categories: `self-harm` (content that
promotes, encourages or depicts self-harm), `self-harm/intent` (the writer
says they intend or are thinking about it) and `self-harm/instructions`
(how to do it). They often fire together, so DevTalk reads them together
(`selfHarmDecision` in `moderation.server.ts`):

| `instructions` | `intent` | `self-harm` | Decision | Support message |
| --- | --- | --- | --- | --- |
| flagged, or score ≥ 0.5 | any | any | Rejected: `self_harm` | Yes |
| not flagged, score < 0.5 | flagged | any (even a high score) | Allowed (if no other rule rejects) | Yes |
| not flagged, score < 0.5 | not flagged | flagged | Rejected: `self_harm` | Yes |
| not flagged, score < 0.5 | not flagged | not flagged | Allowed | No |

Why:

- **Instructions come first.** Saying you are struggling never makes method
  content acceptable, so instructions are rejected whatever else is
  flagged. Because a missed method post is the worst error here, the
  instructions score is also checked at a lower 0.5 caution level, not only
  the provider's flag.
- **A disclosure is not rejected.** When intent is flagged without
  instructions, the post is published, even if `self-harm` also scores high
  (a disclosure usually triggers both). Rejecting someone who reaches out
  would be the wrong response.
- **`self-harm` without intent is treated conservatively.** It covers
  promotion, encouragement and glorification. A recovery story with vivid
  detail may also be caught; the author is shown the support message and can
  rephrase without method or graphic detail.
- **Encouragement aimed at another person** ("you should hurt yourself")
  usually also flags `harassment` or `harassment/threatening` and is
  rejected as `hate_harassment` or `threat`, which rank above `self_harm`.
  The author isn't shown the support message in that case unless the
  provider also flags intent.
- **Other rules still apply.** A disclosure that also harasses someone is
  rejected as `hate_harassment` (with the support message). A disclosure with
  strong profanity is rejected as `profanity` (with the support message).
- **Malformed answers fail closed.** If any of the three flags isn't a
  boolean, or any of the three scores isn't a finite number, moderation is
  unavailable (503) and nothing is published. DevTalk never guesses.
- **Scores are classifier confidence,** not a measure of anyone's personal
  danger. They are never shown, stored or logged.

### The support message

When moderation reads a post as a personal disclosure, or rejects a post
for self-harm content, the author's browser shows this once (a standard
browser dialog, which screen readers announce):

> If you're going through something difficult, support is available.
> Consider reaching out to someone you trust or a qualified mental health
> professional. If you're in immediate danger, contact local emergency
> services or a crisis support service. In the U.S., you can call or text
> 988 (Suicide & Crisis Lifeline). Elsewhere, findahelpline.com lists
> services in many countries.

What it deliberately does not do:

- It doesn't claim anyone is watching, reviewing or will contact the author.
  DevTalk has no one to do that.
- It doesn't assume the author is in the U.S.
- It doesn't label the post or the author. Other users see the post like any
  other.

### Privacy

- **The signal goes only to the author.** `support: true` is in the HTTP
  response to the author's own request and nowhere else.
- **Nothing is stored.** The forum or comment document, the publish receipt
  and the logs carry no support flag, score or self-harm category. A retry of
  the same request returns the original ID without the flag.
- **Logs** record the outcome (`published` or `rejected`), the reason code
  and the field, as for any post. A rejection logs `self_harm`; an allowed
  disclosure logs only `published`, so it can't be told apart from any other
  post.
- **The text is sent to OpenAI** for moderation, as every post is. That is
  the existing provider; DevTalk adds no new processor for this.

### Compared with large platforms

This policy was written after reading the public self-harm policies of
[Meta](https://www.meta.com/safety/topics/wellbeing/suicide-prevention/),
[Microsoft](https://www.microsoft.com/en-us/DigitalSafety/policies) and
[YouTube](https://support.google.com/youtube/answer/2802245) (read
2026-11-07; the Meta and Microsoft pages are summaries, not the full
enforcement rules). DevTalk is a small forum. It is not certified,
audited, or equivalent to these platforms, and does not claim compliance
with any standard.

| Practice described by those platforms | DevTalk |
| --- | --- |
| Allow people to discuss their own experience and ask for support | **Implemented** (intent without instructions is allowed) |
| Prohibit promotion, encouragement, glorification | **Implemented** (`self-harm` without intent is rejected) |
| Prohibit methods and instructions | **Implemented**, with a lower 0.5 score threshold |
| Prohibit self-harm challenges and pressure on others | **Partly**: caught through harassment/threat categories and `self-harm`; no dedicated challenge detection |
| Allow educational, documentary and clinical content | **Implemented** where the model doesn't flag it; flagged depictions may still be rejected |
| Show crisis resources to the person | **Implemented** for the author only (988 in the U.S., findahelpline.com elsewhere) |
| Restrict graphic imagery | **Not applicable**: DevTalk has no images; graphic text is rejected (`graphic_violence`, `self-harm`) |
| Human review, appeals | **Not implemented**: no reviewers; users can contact the maintainer |
| Escalation to emergency services for imminent risk | **Not implemented**, and not promised; the message tells the author to contact emergency services themselves |
| Reduce recommendations or add viewer warnings | **Not implemented**: DevTalk has no recommendation feed or interstitials |
| Extra protection for minors | **Not implemented**: DevTalk does not know users' ages |
| Avoid naming specific methods or locations | Covered by the instructions rule as far as the model detects it |

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

- **Self-harm review:** disclosures are allowed with a support message
  (decided 2026-11-07). If DevTalk later has moderators, decide whether
  rejected self-harm posts should be queued for a person to review.
- **Mild profanity:** should more words count as strong profanity for
  DevTalk's audience?
- **Existing posts:** posts made before this policy were never moderated.
  See `legacy-data.md`.
