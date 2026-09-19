/** Locales with a catalogue. English is the source and every fallback ends there (TD-17). */
export const LOCALES = ["en", "fi", "sv"] as const;
export type Locale = (typeof LOCALES)[number];

/** Accented, elongated, bracketed English: shows clipped and concatenated text in dev builds. */
export const PSEUDO_LOCALE = "en-XA";
export type AnyLocale = Locale | typeof PSEUDO_LOCALE;

export const DEFAULT_LOCALE: Locale = "en";

/** Each language under its own name, which is how a language picker lists them; never translated. */
export const LOCALE_NAMES: Record<AnyLocale, string> = {
  en: "English",
  fi: "Suomi",
  sv: "Svenska",
  "en-XA": "［Pseudo］",
};

const isLocale = (tag: string): tag is Locale => (LOCALES as readonly string[]).includes(tag);

/**
 * The first preference we have a catalogue for, by language ("fi-FI" and "fi"
 * are both Finnish), else English. Input is a list of BCP 47 tags in order of
 * preference: the device's locales, or a parsed Accept-Language header.
 */
export function resolveLocale(preferences: readonly string[]): Locale {
  for (const tag of preferences) {
    const language = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}

const MAX_ACCEPT_LANGUAGE_LENGTH = 256;

/** Language tags of an Accept-Language header, most preferred first; q=0 means "not this one". */
export function parseAcceptLanguage(header: string | undefined | null): string[] {
  if (!header) return [];
  // A real header is a few dozen bytes. The cap bounds the work a hostile one
  // can ask for, since this runs before the rate limiter.
  return header
    .slice(0, MAX_ACCEPT_LANGUAGE_LENGTH)
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1]).find((v) => v !== undefined);
      const weight = q === undefined ? 1 : Number(q);
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter(({ tag, weight }) => tag.length > 0 && tag !== "*" && weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map(({ tag }) => tag);
}
