import type { AnyLocale } from "./locales.ts";
import { PSEUDO_LOCALE } from "./locales.ts";

/**
 * The Intl locale for a catalogue locale: Finland's, in every language. Bare
 * `en` is the United States (9/20/26, 5:14 PM) and bare `sv` is Sweden
 * (2026-09-20); `en-FI` and `sv-FI` are Finland's conventions (20/09/2026,
 * 20.9.2026, 24-hour time, space-grouped numbers with a decimal comma). The
 * pseudo-locale has no Intl data; it is English with odd letters.
 */
export function intlLocale(locale: AnyLocale | string): string {
  switch (locale) {
    case "en":
    case PSEUDO_LOCALE:
      return "en-FI";
    case "sv":
      return "sv-FI";
    default:
      return locale;
  }
}

/** Dates and numbers always go through Intl, never through string building (rules/i18n.md). */
export function formatDate(
  locale: AnyLocale,
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(value);
}

export function formatNumber(
  locale: AnyLocale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/** The grammatical cases a pond's name is stored in (#4: `ponds.name_inessive`). */
export type PondCase = "nominative" | "inessive";

/** A pond as the database hands it over: the name in every case form a sentence may need. */
export type PondName = { name: string; name_inessive?: string | null };

/**
 * A pond's name in the case a sentence needs, read from the stored form and
 * never built: Finnish inflects proper nouns irregularly ("Helsinki",
 * "Helsingissä"), so TD-17 stores each form per pond. English and Swedish
 * use the nominative. Without a stored form the nominative comes back, and the
 * message around it must be one that stays grammatical then.
 */
export function formatPond(pond: PondName, grammaticalCase: PondCase, locale: AnyLocale): string {
  if (locale === "fi" && grammaticalCase === "inessive" && pond.name_inessive) {
    return pond.name_inessive;
  }
  return pond.name;
}
