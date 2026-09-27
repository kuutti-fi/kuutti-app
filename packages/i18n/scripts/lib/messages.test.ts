import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMessages, unreviewed } from "./check.ts";
import { compile } from "./compile.ts";
import { argumentsOf, inflectionProblems, pseudoLocalise } from "./icu.ts";
import { reviewHash } from "./review-hash.ts";
import { type Messages, parseMessages } from "./schema.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SOURCE = readFileSync(resolve(ROOT, "messages.yaml"), "utf8");

const base: Messages = {
  "demo.greeting": {
    en: "Hello",
    description: "Greeting.",
    fi: "Hei",
    sv: "Hej",
    machine: { fi: true, sv: true },
  },
};

const machine = { fi: true, sv: true } as const;

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
    const flagged = base;
    expect(checkMessages(flagged, { release: false }).errors).toEqual([]);
    expect(checkMessages(flagged, { release: true }).errors).toEqual([
      "demo.greeting: fi is still machine-translated; a release needs a native review",
    ]);
    expect(unreviewed(flagged, "fi")).toEqual(["demo.greeting"]);
    // Swedish is not a released language yet (RELEASED_LOCALES): its flag alone blocks nothing.
    const svOnly: Messages = {
      "demo.greeting": {
        ...(base["demo.greeting"] as Messages[string]),
        machine: { sv: true },
        reviewed: { fi: reviewHash("Hello", "Hei") },
      },
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
        machine,
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
        machine,
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
        machine,
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

describe("review states (#55)", () => {
  const greeting = (extra: Partial<Messages[string]>): Messages => ({
    "demo.greeting": { en: "Hello", description: "Greeting.", fi: "Hei", ...extra },
  });

  it("accepts a review hash in the file, and refuses one that is malformed, doubled or orphaned", () => {
    const yaml = (extra: string): string =>
      `demo.greeting:\n  en: Hello\n  description: d\n  fi: Hei\n${extra}`;
    expect(
      parseMessages(yaml(`  reviewed: { fi: "${reviewHash("Hello", "Hei")}" }\n`)),
    ).toBeTruthy();
    expect(() => parseMessages(yaml(`  reviewed: { fi: "xyz" }\n`))).toThrow(/sixteen hex digits/);
    expect(() =>
      parseMessages(yaml(`  machine: { fi: true }\n  reviewed: { fi: "0123456789abcdef" }\n`)),
    ).toThrow(/both machine and reviewed/);
    expect(() => parseMessages(yaml(`  reviewed: { sv: "0123456789abcdef" }\n`))).toThrow(
      /reviewed.sv is set but there is no sv text/,
    );
    const legal = `legal.privacy:\n  en: Policy\n  description: d\n  fi: Seloste\n  consent_version: "1"\n  reviewed: { fi: "0123456789abcdef" }\n`;
    expect(() => parseMessages(legal)).toThrow(/legal text takes no review hash/);
  });

  it("fails a translation that is neither machine text nor reviewed: nobody writes Finnish past the review", () => {
    expect(checkMessages(greeting({}), { release: false }).errors).toEqual([
      "demo.greeting: fi carries neither machine: nor reviewed:; new text carries machine: { fi: true } until a native reviewer approves it (pnpm i18n:review)",
    ]);
    expect(checkMessages(greeting({ machine: { fi: true } }), { release: false }).errors).toEqual(
      [],
    );
    const reviewed = greeting({ reviewed: { fi: reviewHash("Hello", "Hei") } });
    expect(checkMessages(reviewed, { release: true }).errors).toEqual([]);
  });

  it("fails a reviewed text once its English or its translation changes, and not for spacing", () => {
    const hash = reviewHash("Hello", "Hei");
    const english = greeting({ en: "Hello there", reviewed: { fi: hash } });
    const finnish = greeting({ fi: "Moi", reviewed: { fi: hash } });
    for (const edited of [english, finnish]) {
      expect(checkMessages(edited, { release: false }).errors).toEqual([
        "demo.greeting: fi changed since its native review (the English or the fi text); flag it for review again with pnpm i18n:review --reflag --locale fi demo.greeting",
      ]);
    }
    expect(reviewHash(" Hello", "Hei ")).toBe(hash);
    // The same letters, composed differently: NFC makes them one text.
    expect(reviewHash("Hello", "Häh")).toBe(reviewHash("Hello", "Häh"));
  });

  it("keeps legal text out of the review: its Finnish is the source and needs no flag", () => {
    const legal: Messages = {
      "legal.privacy.title": {
        en: "Privacy",
        description: "d",
        fi: "Tietosuoja",
        consent_version: "2026-10-1",
      },
    };
    expect(checkMessages(legal, { release: true })).toEqual({
      errors: [],
      warnings: [
        "legal.privacy.title: no sv text (legal text is written by a person, never by the translator)",
      ],
    });
  });
});

describe("plural and select branches (#55)", () => {
  const likes = (fi: string, en = "{likes, plural, one {# like} other {# likes}}"): Messages => ({
    "demo.likes": { en, description: "d", fi, machine: { fi: true } },
  });

  it("needs every plural form of the language, where =1 answers for one", () => {
    expect(
      checkMessages(likes("{likes, plural, other {# tykkäystä}}"), { release: false }).errors,
    ).toEqual(["demo.likes: fi {likes} lacks the fi plural forms one"]);
    expect(
      checkMessages(likes("{likes, plural, =1 {yksi tykkäys} other {# tykkäystä}}"), {
        release: false,
      }).errors,
    ).toEqual([]);
    expect(
      checkMessages(
        likes("{likes, plural, one {#} other {#}}", "{likes, plural, other {# likes}}"),
        {
          release: false,
        },
      ).errors,
    ).toEqual(["demo.likes: en {likes} lacks the en plural forms one"]);
  });

  it("keeps the exact cases and the select options of the English", () => {
    const zero = likes(
      "{likes, plural, one {# tykkäys} other {# tykkäystä}}",
      "{likes, plural, =0 {No likes} one {# like} other {# likes}}",
    );
    expect(checkMessages(zero, { release: false }).errors).toEqual([
      "demo.likes: fi {likes} lacks the exact cases =0 of en",
    ]);
    const gender: Messages = {
      "demo.seeks": {
        en: "{gender, select, woman {Women} man {Men} other {Everyone}}",
        description: "d",
        fi: "{gender, select, woman {Naiset} other {Kaikki} nonbinary {Muunsukupuoliset}}",
        machine: { fi: true },
      },
    };
    expect(checkMessages(gender, { release: false }).errors).toEqual([
      "demo.seeks: fi {gender} does not have the select options of en (missing man; extra nonbinary)",
    ]);
  });
});

describe("max_length and the release gate (#55)", () => {
  it("holds every language to a max_length, which only fits a text without arguments", () => {
    const button: Messages = {
      "demo.save": {
        en: "Save",
        description: "d",
        fi: "Tallenna muutokset",
        max_length: 10,
        machine: { fi: true },
      },
      "demo.hello": {
        en: "Hi {name}",
        description: "d",
        fi: "Hei {name}",
        max_length: 10,
        machine: { fi: true },
      },
    };
    expect(checkMessages(button, { release: false }).errors).toEqual([
      "demo.save: fi is over its max_length of 10",
      "demo.hello: max_length fits a text without arguments only",
    ]);
  });

  it("refuses draft legal text at a release, and lets it pass before one", () => {
    const draft: Messages = {
      "legal.terms.title": {
        en: "DRAFT Terms",
        description: "d",
        fi: "LUONNOS Käyttöehdot",
        consent_version: "2026-09-draft-1",
      },
    };
    expect(checkMessages(draft, { release: false }).errors).toEqual([]);
    expect(checkMessages(draft, { release: true }).errors).toEqual([
      "legal.terms.title: legal text is still a draft (2026-09-draft-1); a release needs the final wording",
    ]);
  });
});

describe("what the file itself may hold (#55)", () => {
  it("fails a direction-changing character in any text, machine-flagged or not", () => {
    const hidden: Messages = {
      "demo.greeting": {
        en: "Hello",
        description: "d",
        fi: "Hei",
        sv: "Hej ‮if.live‬",
        machine: { fi: true, sv: true },
      },
    };
    expect(checkMessages(hidden, { release: true }).errors).toEqual([
      "demo.greeting: fi is still machine-translated; a release needs a native review",
      "demo.greeting: sv contains control, bidirectional or line-separator characters",
    ]);
  });

  it("refuses a consent_version that is not a plain version name", () => {
    const legal = `legal.privacy.title:\n  en: Privacy\n  description: d\n  fi: Tietosuoja\n  consent_version: "draft\\n::add-mask::x"\n`;
    expect(() => parseMessages(legal)).toThrow(/letters, digits, dots and dashes/);
  });
});

describe("the release gate, after the review of #74", () => {
  it("sees a draft marker however it is capitalised", () => {
    const messages = parseMessages(`
legal.terms.summary:
  en: "Draft: the terms."
  description: The terms the person accepts by version.
  fi: "Luonnos: ehdot."
  consent_version: "2026-10-1"
`);
    const { errors } = checkMessages(messages, { release: true });
    expect(errors.some((e) => e.includes("legal text is still a draft"))).toBe(true);
    expect(checkMessages(messages, { release: false }).errors).toEqual([]);
  });
});

describe("i18n:check, after Copilot's second look at #74", () => {
  it("sees a draft marker anywhere in the wording, as its own word", () => {
    const messages = parseMessages(`
legal.terms.summary:
  en: "The terms (draft)."
  description: The terms the person accepts by version.
  fi: "Ehdot, LUONNOS."
  consent_version: "2026-10-1"
legal.privacy.summary:
  en: "A draftsman's contract."
  description: A word that only contains the marker.
  fi: "Luonnoskirja ei ole luonnosteksti."
  consent_version: "2026-10-1"
`);
    const drafts = checkMessages(messages, { release: true }).errors.filter((e) =>
      e.includes("legal text is still a draft"),
    );
    expect(drafts.map((e) => e.split(":")[0])).toEqual(["legal.terms.summary"]);
  });

  it("holds a text in the file to the tags of its English", () => {
    const messages: Messages = {
      "demo.bold": {
        en: "<b>Hello</b>",
        description: "d",
        fi: "<a>Hei</a>",
        machine: { fi: true },
      },
    };
    expect(checkMessages(messages, { release: false }).errors).toContain(
      "demo.bold: fi does not keep the tags of en",
    );
  });

  it("does not let a translation flatten a plural or a select, or change its kind", () => {
    const messages: Messages = {
      "demo.likes": {
        en: "{likes, plural, one {# like} other {# likes}}",
        description: "d",
        fi: "{likes, number} tykkäystä",
        machine: { fi: true },
      },
      "demo.who": {
        en: "{gender, select, woman {She} man {He} other {They}} liked you",
        description: "d",
        fi: "{gender} tykkäsi sinusta",
        machine: { fi: true },
      },
    };
    const { errors } = checkMessages(messages, { release: false });
    expect(errors).toContain("demo.likes: fi {likes} is a plural in en and is not one here");
    expect(errors).toContain("demo.who: fi {gender} is a select in en and is not one here");
  });
});
