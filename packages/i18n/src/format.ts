import type { AnyLocale } from "./locales.ts";
import { PSEUDO_LOCALE } from "./locales.ts";

// Intl has no data for the pseudo-locale; it is English with odd letters.
const intlLocale = (locale: AnyLocale): string => (locale === PSEUDO_LOCALE ? "en" : locale);

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
