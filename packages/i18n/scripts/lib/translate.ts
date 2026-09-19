import { isMap, isScalar, parseDocument } from "yaml";
import { argumentsOf, inflectionProblems } from "./icu.ts";
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

/** Why a returned translation cannot be written, or undefined when it can. */
export function rejectionReason(
  en: string,
  text: string,
  locale: TranslatedLocale,
): string | undefined {
  if (text.trim().length === 0) return "empty";
  // Machine output is data from outside: no invisible or direction-changing
  // characters, and no link or markup that the English source does not have.
  if (/[\p{Cc}\p{Cf}]/u.test(text)) {
    return "contains control or bidirectional formatting characters";
  }
  if (text.includes("://") && !en.includes("://")) {
    return "contains a link the English source does not have";
  }
  if (MARKUP.test(text) && !MARKUP.test(en)) {
    return "contains markup the English source does not have";
  }
  try {
    const source = argumentsOf(en);
    const target = argumentsOf(text);
    const same =
      Object.keys(source).sort().join() === Object.keys(target).sort().join() &&
      Object.keys(source).every((name) => source[name] === target[name]);
    if (!same) return "does not keep the ICU arguments of the English source";
    const [problem] = inflectionProblems(text, locale);
    return problem;
  } catch (error) {
    return `not valid ICU (${(error as Error).message})`;
  }
}

export type ApplyResult = { yaml: string; written: string[]; rejected: Record<string, string> };

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
    entry.set(locale, text.trim());
    const machine = entry.get("machine");
    if (isMap(machine)) {
      machine.set(locale, true);
    } else {
      const flags = document.createNode({ [locale]: true });
      flags.flow = true;
      entry.set("machine", flags);
    }
    written.push(item.key);
  }

  // A scalar the translator touched keeps its style; everything else is untouched.
  for (const key of written) {
    const value =
      (document.get(key) as ReturnType<typeof document.get> & { get?: unknown }) ?? null;
    if (isMap(value)) {
      const node = value.get(locale, true);
      if (isScalar(node) && typeof node.value === "string" && /[{}:#]/.test(node.value)) {
        node.type = "QUOTE_DOUBLE";
      }
    }
  }
  return { yaml: document.toString({ lineWidth: 0 }), written, rejected };
}
