import { isMap, parseDocument, Scalar, YAMLMap } from "yaml";
import { argumentsOf, branchProblems, inflectionProblems, tagsOf } from "./icu.ts";
import { isAdminKey, isLegalKey, type Messages, type TranslatedLocale } from "./schema.ts";

/** One message as the translator sees it: the key, the English source and its description. */
export type TranslationItem = { key: string; en: string; description: string };

/**
 * Whatever turns English messages into `locale`. The CLI wires the Anthropic
 * API in (anthropic-translator.ts); tests hand in a function. It receives
 * message text, the glossary and the tone guide, and nothing else: no user
 * data ever goes to a translation provider (CLAUDE.md, Security defaults).
 */
export type Translator = (
  locale: TranslatedLocale,
  items: TranslationItem[],
  context: { glossary: string; tone: string },
) => Promise<Record<string, string>>;

/** Keys that need a machine translation: no text yet, and not English-only or legal. */
export function missingTranslations(
  messages: Messages,
  locale: TranslatedLocale,
): TranslationItem[] {
  return Object.entries(messages)
    .filter(([key, message]) => !message[locale] && !isAdminKey(key) && !isLegalKey(key))
    .map(([key, message]) => ({ key, en: message.en, description: message.description }));
}

const MARKUP = /<\/?[a-z][^>]*>/i;
// Invisible or direction-changing characters, and line or paragraph separators.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// Contact details a translation must not add: a web address, an e-mail address,
// a phone number. On a dating app they are how a scam starts.
const DOMAIN = /(^|[^\p{L}\p{N}.@-])\p{L}[\p{L}\p{N}-]*\.[a-z]{2,}(?![\p{L}\p{N}])/iu;
const PHONE = /\+?\d[\d \u00a0-]{6,}\d/;

/**
 * What a text must not carry that its English lacks: invisible characters,
 * a link, markup, contact details. Checked on translator output, on a
 * reviewer's sheet and on the file itself (#13, #55).
 */
export function untrustedTextProblem(en: string, text: string): string | undefined {
  if (INVISIBLE.test(text)) return "contains control, bidirectional or line-separator characters";
  if (text.includes("://") && !en.includes("://")) {
    return "contains a link the English source does not have";
  }
  if (MARKUP.test(text) && !MARKUP.test(en)) {
    return "contains markup the English source does not have";
  }
  if ((DOMAIN.test(text) && !DOMAIN.test(en)) || (text.includes("@") && !en.includes("@"))) {
    return "contains a web or e-mail address the English source does not have";
  }
  if (PHONE.test(text) && !PHONE.test(en)) {
    return "contains a phone number the English source does not have";
  }
  return undefined;
}

/** Why a returned translation cannot be written, or undefined when it can. */
export function rejectionReason(
  en: string,
  text: string,
  locale: TranslatedLocale,
): string | undefined {
  if (text.trim().length === 0) return "empty";
  // Machine output is data from outside, and so is a reviewer's sheet.
  const untrusted = untrustedTextProblem(en, text);
  if (untrusted) return untrusted;
  try {
    const source = argumentsOf(en);
    const target = argumentsOf(text);
    const same =
      Object.keys(source).sort().join() === Object.keys(target).sort().join() &&
      Object.keys(source).every((name) => source[name] === target[name]);
    if (!same) return "does not keep the ICU arguments of the English source";
    if ([...tagsOf(text)].sort().join() !== [...tagsOf(en)].sort().join()) {
      return "does not keep the tags of the English source";
    }
    const [problem] = [...inflectionProblems(text, locale), ...branchProblems(en, text, locale)];
    return problem;
  } catch (error) {
    return `not valid ICU (${(error as Error).message})`;
  }
}

export type ApplyResult = { yaml: string; written: string[]; rejected: Record<string, string> };

// ICU braces, a colon or a hash would each change a plain YAML scalar's meaning:
// such a text is written double-quoted, like the hand-written entries.
const NEEDS_QUOTES = /[{}:#]/;

/** Sets `locale`'s text of one entry, keeping the file's quoting style. */
export function writeText(entry: YAMLMap, locale: TranslatedLocale, text: string): void {
  const node = new Scalar(text.trim());
  if (NEEDS_QUOTES.test(node.value)) node.type = "QUOTE_DOUBLE";
  entry.set(locale, node);
}

/** Marks `locale`'s text as machine text awaiting a native review: `machine: { <locale>: true }`. */
export function flagMachine(entry: YAMLMap, locale: TranslatedLocale): void {
  const reviewed = entry.get("reviewed");
  if (isMap(reviewed)) {
    reviewed.delete(locale);
    if (reviewed.items.length === 0) entry.delete("reviewed");
  }
  const machine = entry.get("machine");
  if (isMap(machine)) {
    machine.set(locale, true);
    return;
  }
  const flags = new YAMLMap();
  flags.flow = true;
  flags.set(locale, true);
  entry.set("machine", flags);
}

/**
 * Writes accepted translations into the YAML text with `machine: { <locale>: true }`,
 * keeping every comment, the key order and the other values as they are. A
 * translation that breaks the rules is reported and not written.
 */
export function applyTranslations(
  yamlText: string,
  messages: Messages,
  locale: TranslatedLocale,
  translations: Record<string, string>,
): ApplyResult {
  const document = parseDocument(yamlText);
  const written: string[] = [];
  const rejected: Record<string, string> = {};

  for (const item of missingTranslations(messages, locale)) {
    const text = translations[item.key];
    if (text === undefined) {
      rejected[item.key] = "the translator returned nothing for this key";
      continue;
    }
    const reason = rejectionReason(item.en, text, locale);
    if (reason) {
      rejected[item.key] = reason;
      continue;
    }
    const entry = document.get(item.key);
    if (!isMap(entry)) continue;
    writeText(entry, locale, text);
    flagMachine(entry, locale);
    written.push(item.key);
  }
  return { yaml: document.toString({ lineWidth: 0 }), written, rejected };
}
