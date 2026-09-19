import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMessages, unreviewed } from "./check.ts";
import { compile } from "./compile.ts";
import { argumentsOf, inflectionProblems, pseudoLocalise } from "./icu.ts";
import { type Messages, parseMessages } from "./schema.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SOURCE = readFileSync(resolve(ROOT, "messages.yaml"), "utf8");

const base: Messages = {
  "demo.greeting": { en: "Hello", description: "Greeting.", fi: "Hei", sv: "Hej" },
};

describe("messages.yaml schema", () => {
  it("accepts the committed file", () => {
    expect(Object.keys(parseMessages(SOURCE)).length).toBeGreaterThan(10);
  });

  it("refuses a legal key with a machine flag, and one without a consent_version", () => {
    const flagged = `legal.privacy:\n  en: Policy\n  description: d\n  fi: Seloste\n  consent_version: "1"\n  machine: { fi: true }\n`;
    expect(() => parseMessages(flagged)).toThrow(/legal text is never machine-translated/);
    const unversioned = `legal.privacy:\n  en: Policy\n  description: d\n  fi: Seloste\n`;
    expect(() => parseMessages(unversioned)).toThrow(/needs a consent_version/);
  });

  it("refuses binding text filed outside legal.*", () => {
    const misfiled = "onboarding.consent.body:\n  en: I agree\n  description: d\n  fi: Hyväksyn\n";
    expect(() => parseMessages(misfiled)).toThrow(/live under legal\.\*/);
  });

  it("refuses English text as a key, an unknown field, and a flag without its text", () => {
    expect(() => parseMessages(`Hello world:\n  en: x\n  description: d\n`)).toThrow(/dotted/);
    expect(() => parseMessages(`a.b:\n  en: x\n  description: d\n  de: y\n`)).toThrow(/not valid/);
    expect(() =>
      parseMessages(`a.b:\n  en: x\n  description: d\n  machine: { fi: true }\n`),
    ).toThrow(/machine.fi is set but there is no fi text/);
  });
});

describe("i18n:check", () => {
  it("passes the committed file outside a release", () => {
    expect(checkMessages(parseMessages(SOURCE), { release: false }).errors).toEqual([]);
  });

  it("fails on a missing fi and only warns on a missing sv", () => {
    const { fi: _fi, ...withoutFi } = base["demo.greeting"] as Messages[string];
    const { sv: _sv, ...withoutSv } = base["demo.greeting"] as Messages[string];
    expect(checkMessages({ "demo.greeting": withoutFi }, { release: false })).toEqual({
      errors: ["demo.greeting: no fi text (Finnish is required)"],
      warnings: [],
    });
    expect(checkMessages({ "demo.greeting": withoutSv }, { release: false })).toEqual({
      errors: [],
      warnings: ["demo.greeting: no sv text"],
    });
  });

  it("lets admin.* stay English only", () => {
    const admin: Messages = { "admin.title": { en: "Admin", description: "d" } };
    expect(checkMessages(admin, { release: false })).toEqual({ errors: [], warnings: [] });
  });

  it("blocks a release while Finnish is machine-translated, and not otherwise", () => {
    const flagged: Messages = {
      "demo.greeting": {
        ...(base["demo.greeting"] as Messages[string]),
        machine: { fi: true, sv: true },
      },
    };
    expect(checkMessages(flagged, { release: false }).errors).toEqual([]);
    expect(checkMessages(flagged, { release: true }).errors).toEqual([
      "demo.greeting: fi is still machine-translated; a release needs a native review",
    ]);
    expect(unreviewed(flagged, "fi")).toEqual(["demo.greeting"]);
    // Swedish has no reviewer yet (out of scope): its flag alone blocks nothing.
    const svOnly: Messages = {
      "demo.greeting": { ...(base["demo.greeting"] as Messages[string]), machine: { sv: true } },
    };
    expect(checkMessages(svOnly, { release: true }).errors).toEqual([]);
  });

  it("bans an inflected dynamic value: 'in {pond}' in English, a glued suffix anywhere", () => {
    const messages: Messages = {
      "round.where": {
        en: "New people in {pond}",
        description: "d",
        fi: "Uusia ihmisiä: {pond}ssa",
        sv: "Nya personer: {pond}",
      },
    };
    const { errors } = checkMessages(messages, { release: false });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/round.where: en "in \{pond\}"/);
    expect(errors[1]).toMatch(/round.where: fi \{pond\} has a suffix glued/);
  });

  it("does not mistake a number for a noun", () => {
    expect(
      inflectionProblems("Try again in {seconds, plural, one {# second} other {# seconds}}", "en"),
    ).toEqual([]);
  });

  it("refuses an argument named like an i18next option, which a caller's value could hijack", () => {
    const messages: Messages = {
      "demo.likes": {
        en: "{count, plural, one {# like} other {# likes}}",
        description: "d",
        fi: "{count, plural, one {# tykkäys} other {# tykkäystä}}",
        sv: "{count, plural, one {# gilla} other {# gillar}}",
      },
    };
    expect(checkMessages(messages, { release: false }).errors).toEqual([
      "demo.likes: {count} is an i18next option name; name the argument after what it counts or holds ({likes}, {seconds})",
    ]);
  });

  it("fails a translation whose arguments differ from the source, and invalid ICU", () => {
    const messages: Messages = {
      "demo.count": {
        en: "{likes, plural, one {# like} other {# likes}}",
        description: "d",
        fi: "{määrä, plural, one {# tykkäys} other {# tykkäystä}}",
        sv: "{likes, plural, one {# gilla",
      },
    };
    const { errors } = checkMessages(messages, { release: false });
    expect(errors[0]).toBe("demo.count: fi does not use the same arguments as en");
    expect(errors[1]).toMatch(/demo.count: sv is not valid ICU/);
  });
});

describe("ICU analysis", () => {
  it("types arguments by their format", () => {
    expect(
      argumentsOf("{name} liked you {times, plural, one {once} other {# times}} on {day, date}"),
    ).toEqual({
      name: "string",
      times: "number",
      day: "date",
    });
  });

  it("pseudo-localises text and leaves the ICU structure alone", () => {
    const pseudo = pseudoLocalise("Retry in {seconds, plural, one {# second} other {# seconds}}");
    expect(pseudo.startsWith("［") && pseudo.endsWith("］")).toBe(true);
    expect(argumentsOf(pseudo)).toEqual({ seconds: "number" });
    expect(pseudo).toContain("Réétrýý");
    // About a third longer, like Finnish against English.
    expect(pseudoLocalise("Reaching the API").length).toBeGreaterThan(
      "Reaching the API".length * 1.25,
    );
  });
});

describe("generated modules", () => {
  it("are what `pnpm i18n:build` produces from messages.yaml (commit them together)", () => {
    const expected = compile(parseMessages(SOURCE));
    const dir = resolve(ROOT, "src", "generated");
    expect(readdirSync(dir).sort()).toEqual(Object.keys(expected).sort());
    for (const [file, content] of Object.entries(expected)) {
      expect(readFileSync(resolve(dir, file), "utf8"), file).toBe(content);
    }
  });
});
