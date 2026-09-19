import { type ArgumentType, argumentsOf, inflectionProblems } from "./icu.ts";
import { isAdminKey, type Messages, TRANSLATED_LOCALES } from "./schema.ts";

// i18next reads these from the same object as the ICU arguments: a message
// that declared one would let a caller's value choose the language, the
// namespace or the key variant instead of filling a gap in the text.
const RESERVED_ARGUMENTS = new Set([
  "lng",
  "lngs",
  "fallbackLng",
  "ns",
  "context",
  "count",
  "ordinal",
  "defaultValue",
  "replace",
  "interpolation",
  "keySeparator",
  "nsSeparator",
  "returnObjects",
  "returnDetails",
  "joinArrays",
  "postProcess",
]);

export type CheckResult = { errors: string[]; warnings: string[] };

function sameArguments(a: Record<string, ArgumentType>, b: Record<string, ArgumentType>): boolean {
  const names = Object.keys(a).sort();
  return (
    names.join() === Object.keys(b).sort().join() && names.every((name) => a[name] === b[name])
  );
}

/**
 * The rules of rules/i18n.md over a validated file: Finnish is required
 * (missing fi fails, missing sv warns; admin.* is English only), every locale
 * is valid ICU with the arguments of the English source, no dynamic value is
 * inflected, and on a release no Finnish text is still machine-translated.
 */
export function checkMessages(messages: Messages, options: { release: boolean }): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [key, message] of Object.entries(messages)) {
    let source: Record<string, ArgumentType>;
    try {
      source = argumentsOf(message.en);
    } catch (error) {
      errors.push(`${key}: en is not valid ICU (${(error as Error).message})`);
      continue;
    }
    for (const problem of inflectionProblems(message.en, "en"))
      errors.push(`${key}: en ${problem}`);
    for (const name of Object.keys(source)) {
      if (RESERVED_ARGUMENTS.has(name)) {
        errors.push(
          `${key}: {${name}} is an i18next option name; name the argument after what it counts or holds ({likes}, {seconds})`,
        );
      }
    }

    for (const locale of TRANSLATED_LOCALES) {
      const text = message[locale];
      if (text === undefined) {
        if (isAdminKey(key)) continue;
        if (locale === "fi") errors.push(`${key}: no fi text (Finnish is required)`);
        else warnings.push(`${key}: no ${locale} text`);
        continue;
      }
      try {
        if (!sameArguments(source, argumentsOf(text))) {
          errors.push(`${key}: ${locale} does not use the same arguments as en`);
        }
        for (const problem of inflectionProblems(text, locale)) {
          errors.push(`${key}: ${locale} ${problem}`);
        }
      } catch (error) {
        errors.push(`${key}: ${locale} is not valid ICU (${(error as Error).message})`);
      }
    }

    if (options.release && message.machine?.fi) {
      errors.push(`${key}: fi is still machine-translated; a release needs a native review`);
    }
  }
  return { errors, warnings };
}

/** Keys whose text in `locale` a native reviewer has not cleared yet. */
export function unreviewed(messages: Messages, locale: "fi" | "sv"): string[] {
  return Object.entries(messages)
    .filter(([, message]) => message.machine?.[locale])
    .map(([key]) => key);
}
