import { describe, expect, it } from "vitest";
import { commandData } from "./annotate.ts";
import { checkMessages } from "./check.ts";
import {
  approve,
  exportSheet,
  formatProgress,
  importSheet,
  newlyReviewed,
  progress,
  reflag,
  selectKeys,
} from "./review.ts";
import { reviewHash } from "./review-hash.ts";
import { parseMessages } from "./schema.ts";

const SOURCE = `# A comment that must survive.
demo.greeting:
  en: Hello
  description: Greeting on the first screen.
  fi: Hei
  sv: Hej
  machine: { fi: true, sv: true }

demo.likes:
  en: "{likes, plural, one {# like} other {# likes}}"
  description: Number of likes.
  fi: "{likes, plural, other {# tykkäystä}}"
  machine: { fi: true }

demo.bye:
  en: Goodbye
  description: Last screen.
  fi: Näkemiin
  reviewed: { fi: "${reviewHash("Goodbye", "Näkemiin")}" }

admin.title:
  en: Admin
  description: English only.

legal.privacy.title:
  en: Privacy
  description: Binding legal text.
  fi: Tietosuoja
  consent_version: "1"
`;

const messages = parseMessages(SOURCE);

/** A sheet as a reviewer returns it: rows edited by column name. */
function edited(sheet: string, edits: Record<string, { fi?: string; approve?: string }>): string {
  const [header = "", ...rows] = sheet.replace(/^﻿/, "").trimEnd().split("\n");
  const columns = header.split("\t");
  const at = (name: string): number => columns.indexOf(name);
  return [
    header,
    ...rows.map((row) => {
      const cells = row.split("\t");
      const edit = edits[cells[at("key")] ?? ""];
      if (edit?.fi !== undefined) cells[at("fi")] = edit.fi;
      if (edit?.approve !== undefined) cells[at("approve")] = edit.approve;
      return cells.join("\t");
    }),
  ].join("\n");
}

describe("i18n:review", () => {
  it("approves machine text: the flag goes, the hash of en and fi comes, the rest of the file stays", () => {
    const result = approve(SOURCE, messages, "fi", ["demo.greeting"]);
    expect(result.approved).toEqual(["demo.greeting"]);
    const after = parseMessages(result.yaml);
    expect(after["demo.greeting"]).toMatchObject({
      fi: "Hei",
      machine: { sv: true },
      reviewed: { fi: reviewHash("Hello", "Hei") },
    });
    expect(result.yaml.startsWith("# A comment that must survive.")).toBe(true);
    expect(result.yaml).toContain(`reviewed: { fi: "${reviewHash("Hello", "Hei")}" }`);
    expect(checkMessages(after, { release: false }).errors).toEqual([
      "demo.likes: fi {likes} lacks the fi plural forms one",
    ]);
  });

  it("refuses to approve text that breaks a rule, legal and admin text, and skips reviewed text", () => {
    const result = approve(SOURCE, messages, "fi", [
      "demo.likes",
      "legal.privacy.title",
      "admin.title",
      "demo.bye",
    ]);
    expect(result.approved).toEqual([]);
    expect(result.refused).toEqual({
      "demo.likes": "{likes} lacks the fi plural forms one",
      "legal.privacy.title":
        "legal text is written by people and versioned by consent_version, not reviewed here",
      "admin.title": "admin.* is English only",
    });
    expect(result.skipped).toEqual({ "demo.bye": "already reviewed" });
    expect(result.yaml).toBe(SOURCE);
  });

  it("selects keys by name or prefix, and reports a selector that names nothing", () => {
    expect(selectKeys(messages, ["demo.*", "nope.key"])).toEqual({
      keys: ["demo.greeting", "demo.likes", "demo.bye"],
      unknown: ["nope.key"],
    });
  });

  it("flags a reviewed text for review again when its English changed", () => {
    const changed = SOURCE.replace("  en: Goodbye", "  en: Goodbye for now");
    const before = parseMessages(changed);
    expect(checkMessages(before, { release: false }).errors).toContain(
      "demo.bye: fi changed since its native review (the English or the fi text); flag it for review again with pnpm i18n:review --reflag --locale fi demo.bye",
    );
    const result = reflag(changed, before, "fi", ["demo.bye", "demo.greeting"]);
    expect(result.flagged).toEqual(["demo.bye"]);
    expect(result.skipped).toEqual({ "demo.greeting": "machine, nothing to flag" });
    const after = parseMessages(result.yaml);
    expect(after["demo.bye"]).toMatchObject({ machine: { fi: true } });
    expect(after["demo.bye"]?.reviewed).toBeUndefined();
  });

  it("counts the review per namespace, for a terminal and for a CI summary", () => {
    const rows = progress(messages);
    expect(rows).toEqual([
      {
        namespace: "demo",
        fi: { reviewed: 1, machine: 2, stale: 0, missing: 0 },
        sv: { reviewed: 0, machine: 1, stale: 0, missing: 2 },
      },
    ]);
    expect(formatProgress(rows, true)).toContain("| demo | 1 | 2 | 0 | 0 | 1 | 0 |");
  });
});

describe("the review sheet", () => {
  const sheet = exportSheet(messages, "fi", "tsv");

  it("lists the texts waiting for a reviewer, with where each shows and a fingerprint", () => {
    const [header, ...rows] = sheet.replace(/^﻿/, "").trimEnd().split("\n");
    expect(sheet.startsWith("﻿")).toBe(true); // so Excel reads it as UTF-8
    expect(header).toBe("key\twhere it shows\ten\tfi\tapprove\tnote\tfingerprint");
    expect(rows.map((row) => row.split("\t")[0])).toEqual(["demo.greeting", "demo.likes"]);
    expect(rows[0]?.split("\t")).toEqual([
      "demo.greeting",
      "Greeting on the first screen.",
      "Hello",
      "Hei",
      "",
      "",
      reviewHash("Hello", "Hei"),
    ]);
    expect(exportSheet(messages, "fi", "md")).toContain(
      "| `demo.greeting` | Greeting on the first screen. | Hello | Hei |  |",
    );
  });

  it("imports approvals, corrections with approval, and corrections that stay machine text", () => {
    const back = edited(sheet, {
      "demo.greeting": { fi: "Moi", approve: "x" },
      "demo.likes": { fi: "{likes, plural, one {# tykkäys} other {# tykkäystä}}" },
    });
    const result = importSheet(SOURCE, messages, "fi", back);
    expect(result).toMatchObject({
      approved: ["demo.greeting"],
      corrected: ["demo.likes"],
      refused: {},
    });
    const after = parseMessages(result.yaml);
    expect(after["demo.greeting"]).toMatchObject({
      fi: "Moi",
      reviewed: { fi: reviewHash("Hello", "Moi") },
    });
    expect(after["demo.likes"]).toMatchObject({
      fi: "{likes, plural, one {# tykkäys} other {# tykkäystä}}",
      machine: { fi: true },
    });
    expect(checkMessages(after, { release: false }).errors).toEqual([]);
  });

  it("changes nothing for a sheet returned as it was", () => {
    const result = importSheet(SOURCE, messages, "fi", sheet);
    expect(result).toMatchObject({
      approved: [],
      corrected: [],
      unchanged: ["demo.greeting", "demo.likes"],
    });
  });

  it("refuses a row whose text changed in the repository after the export, and one that breaks a rule", () => {
    const moved = SOURCE.replace("  fi: Hei\n", "  fi: Terve\n");
    const back = edited(sheet, {
      "demo.greeting": { approve: "yes" },
      "demo.likes": { approve: "x" },
    });
    const result = importSheet(moved, parseMessages(moved), "fi", back);
    expect(result.approved).toEqual([]);
    expect(result.refused).toEqual({
      "demo.greeting": "changed in the repository since the sheet was exported; export it again",
      "demo.likes": "{likes} lacks the fi plural forms one",
    });
    expect(result.yaml).toBe(moved);
  });

  it("reads cells a spreadsheet quoted, and refuses a sheet saved as UTF-16", () => {
    const quoted = edited(sheet, { "demo.greeting": { fi: '"Hei ""sinä"""', approve: "kyllä" } });
    const result = importSheet(SOURCE, messages, "fi", quoted);
    expect(parseMessages(result.yaml)["demo.greeting"]?.fi).toBe('Hei "sinä"');
    expect(() => importSheet(SOURCE, messages, "fi", "k\u0000e\u0000y\u0000")).toThrow(/UTF-8/);
  });

  it("names the texts newly approved since another version of the file, for the pull request", () => {
    const approved = parseMessages(approve(SOURCE, messages, "fi", ["demo.greeting"]).yaml);
    expect(newlyReviewed(messages, approved)).toEqual({ fi: ["demo.greeting"], sv: [] });
    expect(newlyReviewed(messages, messages)).toEqual({ fi: [], sv: [] });
    // A reviewed text whose wording moved under an unchanged hash is named too.
    const moved = parseMessages(SOURCE.replace("  fi: Näkemiin\n", "  fi: Näkemiin nyt\n"));
    expect(newlyReviewed(messages, moved)).toEqual({ fi: ["demo.bye"], sv: [] });
  });

  it("treats a text with neither mark as waiting for review, so a reviewer can approve it", () => {
    const unmarked = SOURCE.replace(
      "  sv: Hej\n  machine: { fi: true, sv: true }\n",
      "  sv: Hej\n  machine: { fi: true }\n",
    );
    const parsed = parseMessages(unmarked);
    expect(progress(parsed)[0]?.sv).toEqual({ reviewed: 0, machine: 1, stale: 0, missing: 2 });
    expect(approve(unmarked, parsed, "sv", ["demo.greeting"]).approved).toEqual(["demo.greeting"]);
  });

  it("reports a sheet row named like an Object.prototype member instead of losing it", () => {
    const back = `key\tfi\tapprove\tfingerprint\n__proto__\tHei\tx\t0\n`;
    expect(importSheet(SOURCE, messages, "fi", back).refused).toEqual(
      Object.defineProperty({}, "__proto__", {
        value: "not in messages.yaml",
        enumerable: true,
        configurable: true,
        writable: true,
      }),
    );
  });
});

describe("CI annotations", () => {
  it("escape a line break, so text in messages.yaml cannot start a workflow command", () => {
    expect(commandData("a\n::add-mask::x 100%")).toBe("a%0A::add-mask::x 100%25");
  });
});
