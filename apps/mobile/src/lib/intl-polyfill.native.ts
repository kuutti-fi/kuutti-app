// Hermes ships Intl.NumberFormat and Intl.DateTimeFormat but neither
// Intl.Locale nor Intl.PluralRules (checked on iOS, RN 0.86), and ICU plurals
// need both: without them the first `{count, plural, ...}` on a phone throws
// MISSING_INTL_API. Each polyfill installs itself only where the API is
// missing; plural data is loaded for the locales that have a catalogue (#13).
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/fi.js";
import "@formatjs/intl-pluralrules/locale-data/sv.js";
