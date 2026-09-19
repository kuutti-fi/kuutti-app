import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";

/** What a caller must pass for one ICU argument. */
export type ArgumentType = "string" | "number" | "date";

/** Every argument of a message with the type its ICU format demands. Throws on invalid ICU. */
export function argumentsOf(message: string): Record<string, ArgumentType> {
  const found: Record<string, ArgumentType> = {};
  const visit = (elements: MessageFormatElement[]): void => {
    for (const el of elements) {
      switch (el.type) {
        case TYPE.argument:
          found[el.value] ??= "string";
          break;
        case TYPE.number:
          found[el.value] = "number";
          break;
        case TYPE.date:
        case TYPE.time:
          found[el.value] = "date";
          break;
        case TYPE.plural:
          found[el.value] = "number";
          for (const option of Object.values(el.options)) visit(option.value);
          break;
        case TYPE.select:
          found[el.value] ??= "string";
          for (const option of Object.values(el.options)) visit(option.value);
          break;
        case TYPE.tag:
          visit(el.children);
          break;
        default:
          break;
      }
    }
  };
  visit(parse(message));
  return found;
}

// A preposition directly before a plain {value} is where English invites an
// inflected noun in Finnish ("in {pond}" has no nominative translation).
const PREPOSITION_BEFORE = /\b(in|at|to|from|of|on|into|with|for|by)\s+$/i;
// A letter, or a colon and letters ("{pond}:ssa"), glued after a plain {value}.
const SUFFIX_AFTER = /^:?\p{L}/u;

/**
 * TD-17: a dynamic value never stands where the sentence inflects it. Reports
 * a plain {argument} that follows a preposition (English source) or carries a
 * glued suffix (any locale). Numbers, plurals and dates are not nouns and pass.
 */
export function inflectionProblems(message: string, locale: string): string[] {
  const problems: string[] = [];
  const visit = (elements: MessageFormatElement[]): void => {
    elements.forEach((el, i) => {
      if (el.type === TYPE.plural || el.type === TYPE.select) {
        for (const option of Object.values(el.options)) visit(option.value);
      } else if (el.type === TYPE.tag) {
        visit(el.children);
      }
      if (el.type !== TYPE.argument) return;
      const before = elements[i - 1];
      const after = elements[i + 1];
      if (
        locale === "en" &&
        before?.type === TYPE.literal &&
        PREPOSITION_BEFORE.test(before.value)
      ) {
        problems.push(
          `"${before.value.trim().split(/\s+/).pop()} {${el.value}}" puts a dynamic value where other languages inflect it`,
        );
      }
      if (after?.type === TYPE.literal && SUFFIX_AFTER.test(after.value)) {
        problems.push(`{${el.value}} has a suffix glued to it: a dynamic value is never inflected`);
      }
    });
  };
  visit(parse(message));
  return problems;
}

const ACCENTS: Record<string, string> = {
  a: "á",
  e: "é",
  i: "í",
  o: "ó",
  u: "ú",
  y: "ý",
  c: "ç",
  n: "ñ",
  s: "š",
  z: "ž",
  A: "Á",
  E: "É",
  I: "Í",
  O: "Ó",
  U: "Ú",
  Y: "Ý",
  C: "Ç",
  N: "Ñ",
  S: "Š",
  Z: "Ž",
};
const VOWEL = /[aeiouyAEIOUY]/;

function pseudoText(text: string): string {
  let out = "";
  for (const char of text) {
    out += ACCENTS[char] ?? char;
    // Every vowel doubled: about a third longer, as Finnish runs against English.
    if (VOWEL.test(char)) out += ACCENTS[char] ?? char;
  }
  return out;
}

/**
 * The en-XA pseudo-locale: accented, elongated, bracketed text with the ICU
 * structure untouched, so clipped or concatenated strings show in a dev build.
 */
export function pseudoLocalise(message: string): string {
  const transform = (elements: MessageFormatElement[]): MessageFormatElement[] =>
    elements.map((el) => {
      if (el.type === TYPE.literal) return { ...el, value: pseudoText(el.value) };
      if (el.type === TYPE.plural || el.type === TYPE.select) {
        const options = Object.fromEntries(
          Object.entries(el.options).map(([name, option]) => [
            name,
            { ...option, value: transform(option.value) },
          ]),
        );
        return { ...el, options };
      }
      if (el.type === TYPE.tag) return { ...el, children: transform(el.children) };
      return el;
    });
  return `［${printAST(transform(parse(message)))}］`;
}
