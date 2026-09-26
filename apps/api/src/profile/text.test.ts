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
  ] as const)("%s is refused as %s", (text, kind) => {
    expect(contactDetailsIn(text)).toBe(kind);
  });

  it.each([
    "I like coffee and long walks by the sea.",
    "Born in 1990, two cats, one sourdough starter",
    "Aalto 2024, guild of the year",
    "email me? no. talk to me here.",
    "10 out of 10 would hike again",
  ])("%s passes", (text) => {
    expect(contactDetailsIn(text)).toBeNull();
  });
});
