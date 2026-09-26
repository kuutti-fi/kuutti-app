import { describe, expect, it } from "vitest";
import { contactDetailsIn } from "./text.ts";

describe("the plain-text rule", () => {
  it.each([
    ["write me at aino.v@example.com", "email"],
    ["see www.example.fi for more", "url"],
    ["https://example.com/me", "url"],
    ["my site is kuutti.app", "url"],
    ["+358 40 123 4567", "phone"],
    ["0401234567", "phone"],
    ["call 040-123 45 67 tonight", "phone"],
    ["find me @nick_name", "handle"],
    ["I am on Instagram a lot", "handle"],
    ["telegram works best", "handle"],
    ["Löydät mut instagramissa", "handle"],
    ["oon instassa aino_v", "handle"],
    ["IG: aino_v", "handle"],
    ["aino@exam\u200Bple\u200B.com", "email"],
    ["aino dot v at gmail dot com", "email"],
    ["aino (at) gmail (dot) com", "email"],
    ["\uFF10\uFF14\uFF10\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17", "phone"],
    ["\u0660\u0664\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667", "phone"],
    ["040/123/4567", "phone"],
    ["my site is example.xyz", "url"],
    ["find me:@nick", "handle"],
    ["@äiti kertoi", "handle"],
    ["0 4 0 · 1 2 3 · 4 5 6 7", "phone"],
  ] as const)("%s is refused as %s", (text, kind) => {
    expect(contactDetailsIn(text)).toBe(kind);
  });

  it.each([
    "I like coffee and long walks by the sea.",
    "Born in 1990, two cats, one sourdough starter",
    "Aalto 2024, guild of the year",
    "email me? no. talk to me here.",
    "10 out of 10 would hike again",
    "e.g. hiking, i.e. a lot of it",
    "3.5 km runs before breakfast",
  ])("%s passes", (text) => {
    expect(contactDetailsIn(text)).toBeNull();
  });
});
