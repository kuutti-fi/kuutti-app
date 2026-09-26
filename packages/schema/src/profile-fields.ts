import { z } from "zod";

/**
 * The profile fields (#47, TD-16): one registry, read by the API for
 * validation, by the app for the form and the card, and by the research
 * snapshot of #50 for its coarse categories. A closed list keeps the card
 * free of contact details and of text a moderator would have to read;
 * adding an option is a change here and no migration. `specialCategory`
 * marks a field whose value is an article 9 category: its value is refused
 * until the person has given the explicit consent of that version
 * (ADR-009). None of the fields below is one on its face; `seeks` (#46) and
 * any later field that is one take the flag.
 */

export const LANGUAGES = [
  "fi",
  "sv",
  "en",
  "ru",
  "et",
  "uk",
  "ar",
  "so",
  "de",
  "fr",
  "es",
  "other",
] as const;
export const LANGUAGES_MAX = 5;

type Options = readonly [string, ...string[]];

const single = <T extends Options>(options: T, specialCategory = false) => ({
  kind: "single" as const,
  options,
  specialCategory,
  schema: z.enum(options),
});

const multi = <T extends Options>(options: T, max: number, specialCategory = false) => ({
  kind: "multi" as const,
  options,
  max,
  specialCategory,
  schema: z.array(z.enum(options)).min(1).max(max),
});

const text = (maxLength: number, specialCategory = false) => ({
  kind: "text" as const,
  maxLength,
  specialCategory,
  schema: z.string().trim().min(1).max(maxLength),
});

export const PROFILE_FIELDS = {
  languages: multi(LANGUAGES, LANGUAGES_MAX),
  intent: single(["long_term", "short_term", "figuring_out", "friends"]),
  relationship: single(["monogamous", "open", "polyamorous", "lat", "undecided"]),
  kids: single(["have_want_more", "have_done", "want_someday", "dont_want", "not_sure"]),
  smoking: single(["no", "sometimes", "yes", "snus"]),
  alcohol: single(["never", "sometimes", "often"]),
  education: single(["secondary", "vocational", "bachelor", "master", "doctorate", "other"]),
  field: single([
    "tech",
    "engineering",
    "business",
    "arts",
    "science",
    "health",
    "education",
    "law",
    "social",
    "trades",
    "service",
    "other",
  ]),
  /** Campus or guild, in the person's words: short, and under the plain-text rule like every free text. */
  campus: text(40),
} as const;

export type ProfileFieldKey = keyof typeof PROFILE_FIELDS;
export const PROFILE_FIELD_KEYS = Object.keys(PROFILE_FIELDS) as ProfileFieldKey[];

export type ProfileFieldSpec = (typeof PROFILE_FIELDS)[ProfileFieldKey];

/** The fields whose value needs the explicit consent first; empty today (ADR-009). */
export const SPECIAL_CATEGORY_FIELDS = PROFILE_FIELD_KEYS.filter(
  (key) => PROFILE_FIELDS[key].specialCategory,
);

/** Every field optional: unanswered is a legitimate state, never a default value. */
export const ProfileFields = z
  .object({
    languages: PROFILE_FIELDS.languages.schema.optional(),
    intent: PROFILE_FIELDS.intent.schema.optional(),
    relationship: PROFILE_FIELDS.relationship.schema.optional(),
    kids: PROFILE_FIELDS.kids.schema.optional(),
    smoking: PROFILE_FIELDS.smoking.schema.optional(),
    alcohol: PROFILE_FIELDS.alcohol.schema.optional(),
    education: PROFILE_FIELDS.education.schema.optional(),
    field: PROFILE_FIELDS.field.schema.optional(),
    campus: PROFILE_FIELDS.campus.schema.optional(),
  })
  .strict()
  .meta({ id: "ProfileFields" });
export type ProfileFields = z.infer<typeof ProfileFields>;
