/**
 * @jest-environment node
 *
 * Strong-profanity checks (synthetic examples only).
 */
import { containsProfanity, normalizedTokens } from "../profanity.server";

describe("containsProfanity", () => {
  it.each([
    "This is fucking broken",
    "What the FUCK happened",
    "motherfucker",
    "Total bullshit",
    "this build is shit",
    "this build is shit!",
    "You absolute asshole",
    "stop being a bitch about it",
  ])("rejects strong profanity: %s", (text) => {
    expect(containsProfanity(text)).toBe(true);
  });

  it.each([
    ["case", "FuCk this"],
    ["leetspeak digits", "sh1t code"],
    ["symbols", "$h!t code"],
    ["repeated letters", "fuuuuck"],
    ["spaced letters", "f u c k"],
    ["dotted letters", "s.h.i.t"],
    ["accents", "fück"],
    ["zero-width characters", "fu​ck"],
  ])("sees through %s", (_label, text) => {
    expect(containsProfanity(text)).toBe(true);
  });

  it.each([
    "Scunthorpe United won",
    "Arigatou gozaimashita, Yamashita-san",
    "The assessment covers class components",
    "A cocktail of dependencies",
    "Ask a therapist about burnout",
    "Shiitake mushrooms in the docs example",
    "Damn, this hell of a bug sucks",
    "What the heck, this is crap",
    "f*ck, s**t happens",
    "Use a hashmap; the bitmask is fine",
    "Pass the documents to the analyst",
    "Sussex and Essex office hours",
    "I'll take a b c d e as options",
  ])("allows ordinary words and mild or masked language: %s", (text) => {
    expect(containsProfanity(text)).toBe(false);
  });

  it("tokenizes into lowercase letters only", () => {
    expect(normalizedTokens("Hello, Wörld! 42")).toEqual(expect.arrayContaining(["helo", "world"]));
  });
});
