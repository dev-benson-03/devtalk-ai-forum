/**
 * Strong-profanity check for the DevTalk SFW policy
 * (docs/architecture/content-policy.md). The moderation model has no
 * profanity category, so this supplements it.
 *
 * Matching works on whole words after normalization, not on raw substrings,
 * so words like "Scunthorpe", "Yamashita", "assessment", "class",
 * "cocktail" or "therapist" are not affected. Normalization undoes common evasions:
 * letter case, accents, zero-width characters, look-alike digits and symbols
 * ("sh1t", "$hit"), repeated letters ("fuuuck") and letters separated by
 * spaces or punctuation ("f.u.c.k"). Self-masked words ("f*ck", "s**t") are
 * allowed on purpose: the writer has already censored them.
 */

/** How a listed word may appear in a normalized token. */
interface Rule {
  /** The word as listed (lowercase, letters only). */
  word: string;
  /**
   * "contains": anywhere inside a token ("motherfucker", "clusterfuck").
   * Only for a word that is never part of an ordinary word or name.
   * "exact": the token must be one of `forms`. Used where the letters also
   * occur inside ordinary words or names (e.g. "shit" in Yamashita,
   * "cunt" in Scunthorpe).
   */
  match: "contains" | "exact";
  forms?: string[];
}

/**
 * Deliberately short: strong profanity only. Mild words (damn, hell, crap,
 * sucks) are allowed. Slurs, sexual content and harassment are left to the
 * moderation model, which judges them in context.
 */
export const PROFANITY_RULES: readonly Rule[] = [
  { word: "fuck", match: "contains" },
  {
    word: "shit",
    match: "exact",
    forms: [
      "shit", "shits", "shitty", "shitter", "shitting", "shitload", "shithead", "shitheads", "shitshow",
      "shithole", "shitpost", "shitposting", "bullshit", "horseshit", "dipshit", "apeshit", "batshit",
      "chickenshit",
    ],
  },
  { word: "cunt", match: "exact", forms: ["cunt", "cunts", "cunty"] },
  { word: "asshole", match: "exact", forms: ["asshole", "assholes", "arsehole", "arseholes"] },
  { word: "bitch", match: "exact", forms: ["bitch", "bitches", "bitchy", "bitching", "bitched"] },
  { word: "twat", match: "exact", forms: ["twat", "twats"] },
  { word: "wanker", match: "exact", forms: ["wanker", "wankers"] },
  { word: "slut", match: "exact", forms: ["slut", "sluts", "slutty"] },
  { word: "whore", match: "exact", forms: ["whore", "whores"] },
];

/** Digits and symbols commonly used in place of letters. */
const LOOKALIKES: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "7": "t",
  "+": "t",
};

/** Same letter repeated collapses to one, so "fuuuck" and "fuck" compare equal. */
const squeeze = (word: string) => word.replace(/([a-z])\1+/g, "$1");

function words(text: string): string[] {
  const raw = text.split(/[^a-z]+/).filter(Boolean);
  // Runs of single letters ("f u c k", "f.u.c.k") are also read as one word
  const joined: string[] = [];
  for (let i = 0; i < raw.length; ) {
    let j = i;
    while (j < raw.length && raw[j].length === 1) j++;
    if (j - i >= 3) joined.push(raw.slice(i, j).join(""));
    i = Math.max(j, i + 1);
  }
  return [...raw, ...joined];
}

/**
 * Lowercase, letters-only tokens of the text with evasions undone. Symbols
 * are read both as separators ("shit!") and as look-alike letters ("sh!t").
 */
export function normalizedTokens(text: string): string[] {
  const plain = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // accents
    .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "") // soft hyphen, zero-width
    .toLowerCase();
  const lookalike = plain.replace(/[0-9!|@$+]/g, (ch) => LOOKALIKES[ch] ?? ch);
  return [...new Set([...words(plain), ...words(lookalike)].map(squeeze))];
}

function matches(token: string, rule: Rule): boolean {
  if (rule.match === "contains") return token.includes(squeeze(rule.word));
  return (rule.forms ?? [rule.word]).some((form) => token === squeeze(form));
}

/** True when the text contains strong profanity under the policy. */
export function containsProfanity(text: string): boolean {
  return normalizedTokens(text).some((token) => PROFANITY_RULES.some((rule) => matches(token, rule)));
}
