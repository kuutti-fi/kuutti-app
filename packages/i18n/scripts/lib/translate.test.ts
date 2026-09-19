import { describe, expect, it } from "vitest";
import { checkMessages } from "./check.ts";
import { parseMessages } from "./schema.ts";
import { applyTranslations, missingTranslations, type Translator } from "./translate.ts";

const SOURCE = `# A comment that must survive.
demo.greeting:
  en: Hello
  description: Greeting on the first screen.
  sv: Hej

demo.count:
  en: "{likes, plural, one {# like} other {# likes}}"
  description: Number of likes.

demo.where:
  en: "Your pond: {pond}"
  description: Shows the member's pond.

admin.title:
  en: Admin
  description: English only.

legal.privacy:
  en: Privacy policy
  description: Binding legal text.
  consent_version: "1"
`;

// Deterministic stand-in for the provider: no network in tests (CLAUDE.md Testing).
const fake: Translator = async (_locale, items) =>
  Object.fromEntries(
    items.map((item) => [
      item.key,
      {
        "demo.greeting": "Hei",
        "demo.count": "{likes, plural, one {# tykkäys} other {# tykkäystä}}",
        "demo.where": "Lampesi: {pond}ssa",
      }[item.key] ?? "",
    ]),
  );

describe("i18n:translate", () => {
  it("asks only for keys without text, and never for admin or legal keys", () => {
    const messages = parseMessages(SOURCE);
    expect(missingTranslations(messages, "fi").map((i) => i.key)).toEqual([
      "demo.greeting",
      "demo.count",
      "demo.where",
    ]);
    expect(missingTranslations(messages, "sv").map((i) => i.key)).toEqual([
      "demo.count",
      "demo.where",
    ]);
  });

  it("writes a Finnish value flagged machine: true, and keeps the rest of the file as it was", async () => {
    const messages = parseMessages(SOURCE);
    const items = missingTranslations(messages, "fi");
    const result = applyTranslations(
      SOURCE,
      messages,
      "fi",
      await fake("fi", items, { glossary: "", tone: "" }),
    );

    expect(result.written).toEqual(["demo.greeting", "demo.count"]);
    const after = parseMessages(result.yaml);
    expect(after["demo.greeting"]).toMatchObject({ fi: "Hei", sv: "Hej", machine: { fi: true } });
    expect(after["demo.count"]?.fi).toBe("{likes, plural, one {# tykkäys} other {# tykkäystä}}");
    expect(result.yaml.startsWith("# A comment that must survive.")).toBe(true);
    expect(after["legal.privacy"]?.fi).toBeUndefined();
    expect(after["admin.title"]?.fi).toBeUndefined();
  });

  it("refuses a translation that inflects a dynamic value, and says why", async () => {
    const messages = parseMessages(SOURCE);
    const items = missingTranslations(messages, "fi");
    const result = applyTranslations(
      SOURCE,
      messages,
      "fi",
      await fake("fi", items, { glossary: "", tone: "" }),
    );
    expect(result.rejected["demo.where"]).toMatch(/suffix glued/);
    expect(parseMessages(result.yaml)["demo.where"]?.fi).toBeUndefined();
  });

  it("refuses a translation that changes the ICU arguments", () => {
    const messages = parseMessages(SOURCE);
    const result = applyTranslations(SOURCE, messages, "fi", {
      "demo.greeting": "Hei",
      "demo.count": "{määrä} tykkäystä",
      "demo.where": "Lampesi: {pond}",
    });
    expect(result.rejected).toEqual({
      "demo.count": "does not keep the ICU arguments of the English source",
    });
  });

  it("refuses machine output with invisible characters, or a link or markup the source lacks", () => {
    const messages = parseMessages(SOURCE);
    const result = applyTranslations(SOURCE, messages, "fi", {
      "demo.greeting": "Hei\u202E",
      "demo.count": "{likes, plural, one {# tykkäys} other {# tykkäystä}} https://example.com",
      "demo.where": "<b>Lampesi</b>: {pond}",
    });
    expect(result.written).toEqual([]);
    expect(Object.values(result.rejected)).toEqual([
      "contains control or bidirectional formatting characters",
      "contains a link the English source does not have",
      "contains markup the English source does not have",
    ]);
  });

  it("leaves a file whose machine-translated Finnish blocks a release until a reviewer clears it", async () => {
    const messages = parseMessages(SOURCE);
    const result = applyTranslations(SOURCE, messages, "fi", {
      "demo.greeting": "Hei",
      "demo.count": "{likes, plural, one {# tykkäys} other {# tykkäystä}}",
      "demo.where": "Lampesi: {pond}",
    });
    const after = parseMessages(result.yaml);
    // The one thing left is the legal text: the script never fills it, a person must.
    expect(checkMessages(after, { release: false }).errors).toEqual([
      "legal.privacy: no fi text (Finnish is required)",
    ]);
    const release = checkMessages(after, { release: true }).errors;
    expect(release.filter((e) => e.includes("still machine-translated"))).toHaveLength(3);
  });
});
