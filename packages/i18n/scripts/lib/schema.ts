import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** Locales a message may carry. English is the source; en-XA is generated. */
export const TRANSLATED_LOCALES = ["fi", "sv"] as const;
export type TranslatedLocale = (typeof TRANSLATED_LOCALES)[number];

const KEY_PATTERN = /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

const MachineFlags = z.strictObject({ fi: z.boolean().optional(), sv: z.boolean().optional() });

const Message = z.strictObject({
  en: z.string().min(1),
  description: z.string().min(1),
  fi: z.string().min(1).optional(),
  sv: z.string().min(1).optional(),
  machine: MachineFlags.optional(),
  /** legal.* only: the consent version this wording belongs to (TD-17). */
  consent_version: z.string().min(1).optional(),
});
export type Message = z.infer<typeof Message>;
export type Messages = Record<string, Message>;

const File = z.record(z.string(), Message);

/** True for keys whose text is binding legal text: never machine-translated. */
export const isLegalKey = (key: string): boolean => key.startsWith("legal.");

// A backstop for the prefix rule: binding text filed under another name would
// be sent to the translator and could carry a machine flag.
const LEGAL_WORD = /(^|[._])(legal|consent|privacy|terms|police|traceability)([._]|$)/i;

/** True for keys of the English-only moderation panel (TD-17). */
export const isAdminKey = (key: string): boolean => key.startsWith("admin.");

/**
 * Parses and validates messages.yaml. Throws with every problem at once: a
 * file that does not validate never reaches the compiler.
 */
export function parseMessages(yamlText: string): Messages {
  const parsed = File.safeParse(parseYaml(yamlText));
  const problems: string[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

  for (const [key, message] of Object.entries(parsed.success ? parsed.data : {})) {
    if (!KEY_PATTERN.test(key)) {
      problems.push(`${key}: keys are dotted and semantic (profile.bio.required), never the text`);
    }
    if (!isLegalKey(key) && LEGAL_WORD.test(key)) {
      problems.push(
        `${key}: consent, privacy, terms and police-traceability texts live under legal.*`,
      );
    }
    if (isLegalKey(key)) {
      if (message.machine) problems.push(`${key}: legal text is never machine-translated`);
      if (!message.consent_version) problems.push(`${key}: legal text needs a consent_version`);
    } else if (message.consent_version) {
      problems.push(`${key}: consent_version belongs to legal.* keys only`);
    }
    for (const locale of TRANSLATED_LOCALES) {
      if (message.machine?.[locale] && !message[locale]) {
        problems.push(`${key}: machine.${locale} is set but there is no ${locale} text`);
      }
    }
  }

  if (problems.length > 0)
    throw new Error(`messages.yaml is not valid:\n  ${problems.join("\n  ")}`);
  if (!parsed.success) throw new Error("messages.yaml is not valid");
  return parsed.data;
}
