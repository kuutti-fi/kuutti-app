import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Translator } from "./translate.ts";

const LANGUAGE = { fi: "Finnish", sv: "Swedish (as written in Finland)" } as const;

const Output = z.object({
  translations: z.array(z.object({ key: z.string(), text: z.string() })),
});

/**
 * The translator behind `pnpm i18n:translate`: one request to the Claude API
 * with structured output. Credentials come from the developer's environment
 * (ANTHROPIC_API_KEY or an `ant auth login` profile), never from the
 * repository. The request carries message text, the glossary and the tone
 * guide only. Its output is a draft: every value is written with
 * machine: true and a native reviewer clears the flag (rules/i18n.md).
 */
export function anthropicTranslator(): Translator {
  const client = new Anthropic();
  return async (locale, items, context) => {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [
        `You translate the user interface text of Kuutti, a free, non-commercial Finnish dating app, from English into ${LANGUAGE[locale]}.`,
        "Each item has a key, the English text and a description of where the text appears. Return one translation per key.",
        "The text is ICU MessageFormat. Keep every argument name and the whole plural or select structure exactly as in the English source, and add every plural category the target language needs.",
        "Never inflect a dynamic value: an argument such as {pond} or {name} may only stand where the language needs no case ending on it. Restructure the sentence instead (for example after a colon).",
        "Follow the tone guide. A glossary term that has a translation must be used exactly; a term without one is explained by its definition only.",
        `<tone_guide>\n${context.tone}\n</tone_guide>`,
        `<glossary>\n${context.glossary}\n</glossary>`,
      ].join("\n\n"),
      messages: [{ role: "user", content: JSON.stringify({ items }, null, 2) }],
      output_config: { format: zodOutputFormat(Output) },
    });

    // A refusal or a cut-off answer is reported, never half-written.
    if (response.stop_reason === "refusal") {
      throw new Error(
        `the model declined the request (${response.stop_details?.category ?? "no category"})`,
      );
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new Error(
        "the model's answer was cut off or did not match the schema; translate fewer keys at once",
      );
    }
    return Object.fromEntries(response.parsed_output.translations.map((t) => [t.key, t.text]));
  };
}
