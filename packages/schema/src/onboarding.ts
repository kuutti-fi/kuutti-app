import { z } from "zod";
import { AccountState } from "./account-state.ts";

/**
 * Onboarding and consents (#46, ADR-010): the four answers matching cannot
 * start without, the consents nothing may start without, and the research
 * opt-in. Gender is self-declared (rule 3); seeks and the age window are the
 * hard filters of rule 7; a consent names the version of the text it is for.
 */

export const GENDERS = ["woman", "man", "non_binary"] as const;
export const Gender = z.enum(GENDERS).meta({ id: "Gender" });
export type Gender = z.infer<typeof Gender>;

export const AGE_MIN = 18;
export const AGE_MAX = 99;

export const AgeWindow = z
  .object({
    min: z.int().min(AGE_MIN).max(AGE_MAX),
    max: z.int().min(AGE_MIN).max(AGE_MAX),
  })
  .strict()
  .refine((w) => w.min <= w.max, { message: "min is at most max", path: ["max"] })
  .meta({ id: "AgeWindow" });
export type AgeWindow = z.infer<typeof AgeWindow>;

const distinct = (values: readonly string[]) => new Set(values).size === values.length;

export const PreferencesUpdate = z
  .object({
    seeks: z
      .array(Gender)
      .min(1)
      .max(GENDERS.length)
      .refine(distinct, { message: "each gender at most once" }),
    ageWindow: AgeWindow,
  })
  .strict()
  .meta({ id: "PreferencesUpdate" });
export type PreferencesUpdate = z.infer<typeof PreferencesUpdate>;

export const PreferencesResponse = z
  .object({
    seeks: z.array(Gender).max(GENDERS.length).nullable(),
    ageWindow: AgeWindow.nullable(),
  })
  .meta({ id: "PreferencesResponse" });
export type PreferencesResponse = z.infer<typeof PreferencesResponse>;

export const GenderUpdate = z.object({ gender: Gender }).strict().meta({ id: "GenderUpdate" });
export type GenderUpdate = z.infer<typeof GenderUpdate>;

/** A pond with both case forms: the app never inflects (TD-17). */
export const PondSummary = z
  .object({
    id: z.uuid(),
    slug: z.string().min(1).max(60),
    name: z.string().min(1).max(80),
    nameInessive: z.string().min(1).max(80),
    parentId: z.uuid().nullable(),
  })
  .meta({ id: "PondSummary" });
export type PondSummary = z.infer<typeof PondSummary>;

export const PondList = z.object({ ponds: z.array(PondSummary).max(200) }).meta({ id: "PondList" });
export type PondList = z.infer<typeof PondList>;

export const PondChoice = z.object({ pondId: z.uuid() }).strict().meta({ id: "PondChoice" });
export type PondChoice = z.infer<typeof PondChoice>;

export const CONSENT_KINDS = ["terms", "privacy", "research"] as const;
export const ConsentKind = z.enum(CONSENT_KINDS).meta({ id: "ConsentKind" });
export type ConsentKind = z.infer<typeof ConsentKind>;

/** The languages the texts exist in; the Finnish wording is the binding one (TD-17). */
export const CONSENT_LOCALES = ["fi", "sv", "en"] as const;

export const ConsentRequest = z
  .object({
    kind: ConsentKind,
    /** The consent_version of the wording the person read; an old one is refused. */
    version: z.string().min(1).max(40),
    locale: z.enum(CONSENT_LOCALES),
  })
  .strict()
  .meta({ id: "ConsentRequest" });
export type ConsentRequest = z.infer<typeof ConsentRequest>;

export const ConsentRecord = z
  .object({
    kind: ConsentKind,
    version: z.string().max(40),
    locale: z.enum(CONSENT_LOCALES),
    givenAt: z.iso.datetime(),
    withdrawnAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "ConsentRecord" });
export type ConsentRecord = z.infer<typeof ConsentRecord>;

export const ConsentVersions = z
  .object({ terms: z.string().max(40), privacy: z.string().max(40), research: z.string().max(40) })
  .meta({
    id: "ConsentVersions",
    description: "The consent_version of the current wording per kind.",
  });
export type ConsentVersions = z.infer<typeof ConsentVersions>;

export const ConsentsResponse = z
  .object({
    /** The newest hundred, oldest first; the export carries every row. */
    consents: z.array(ConsentRecord).max(100),
    currentVersions: ConsentVersions,
  })
  .meta({ id: "ConsentsResponse" });
export type ConsentsResponse = z.infer<typeof ConsentsResponse>;

/** What activation waits for; research is never one of them. */
export const OnboardingStep = z
  .enum(["gender", "seeks", "age_window", "pond", "terms", "privacy"])
  .meta({ id: "OnboardingStep" });
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export const OnboardingStatus = z
  .object({
    state: AccountState,
    gender: Gender.nullable(),
    pond: PondSummary.nullable(),
    preferences: PreferencesResponse,
    consents: z.object({
      /** The version accepted, when it is the current one; an old consent reads as null. */
      terms: z.string().max(40).nullable(),
      privacy: z.string().max(40).nullable(),
      /** The active research opt-in, when its version is the current one. */
      research: z.object({ version: z.string().max(40), givenAt: z.iso.datetime() }).nullable(),
    }),
    currentVersions: ConsentVersions,
    missing: z.array(OnboardingStep).max(6),
    complete: z.boolean(),
  })
  .meta({ id: "OnboardingStatus" });
export type OnboardingStatus = z.infer<typeof OnboardingStatus>;
