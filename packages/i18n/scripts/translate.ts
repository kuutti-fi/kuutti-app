/**
 * `pnpm i18n:translate [--locale fi|sv] [--dry-run]`: fills missing Finnish and
 * Swedish texts by machine, flagged `machine: true` for a native reviewer.
 * `pnpm i18n:translate --review` lists what still carries the flag.
 * legal.* keys are never sent; admin.* keys are English only (#13, TD-17).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { unreviewed } from "./lib/check.ts";
import { parseMessages, TRANSLATED_LOCALES, type TranslatedLocale } from "./lib/schema.ts";
import { applyTranslations, missingTranslations } from "./lib/translate.ts";

const root = resolve(import.meta.dirname, "..");
const file = resolve(root, "messages.yaml");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args[args.indexOf("--locale") + 1];
const locales: TranslatedLocale[] =
  args.includes("--locale") && (TRANSLATED_LOCALES as readonly string[]).includes(only ?? "")
    ? [only as TranslatedLocale]
    : [...TRANSLATED_LOCALES];

if (args.includes("--review")) {
  const messages = parseMessages(readFileSync(file, "utf8"));
  for (const locale of locales) {
    const keys = unreviewed(messages, locale);
    console.log(`${locale}: ${keys.length} machine-translated texts awaiting a native review`);
    for (const key of keys)
      console.log(
        `  ${key}\n    en: ${messages[key]?.en}\n    ${locale}: ${messages[key]?.[locale]}`,
      );
  }
  console.log(
    "\nTo clear one: correct the text if needed, then delete its locale from `machine:`.",
  );
  process.exit(0);
}

// Loaded only when a request is really made, so --review needs no SDK and no key.
const { anthropicTranslator } = await import("./lib/anthropic-translator.ts");
const context = {
  glossary: readFileSync(resolve(root, "glossary.yaml"), "utf8"),
  tone: readFileSync(resolve(root, "..", "..", "docs", "i18n", "tone.md"), "utf8"),
};

let translate: ReturnType<typeof anthropicTranslator> | undefined;
for (const locale of locales) {
  const yamlText = readFileSync(file, "utf8");
  const messages = parseMessages(yamlText);
  const items = missingTranslations(messages, locale);
  if (items.length === 0) {
    console.log(`${locale}: nothing to translate`);
    continue;
  }
  console.log(
    `${locale}: ${items.length} keys without text${dryRun ? " (dry run, nothing sent)" : ""}`,
  );
  if (dryRun) {
    for (const item of items) console.log(`  ${item.key}`);
    continue;
  }
  translate ??= anthropicTranslator();
  const result = applyTranslations(
    yamlText,
    messages,
    locale,
    await translate(locale, items, context),
  );
  writeFileSync(file, result.yaml);
  console.log(`${locale}: wrote ${result.written.length}, flagged machine: true`);
  for (const [key, reason] of Object.entries(result.rejected))
    console.error(`✖ ${locale} ${key}: ${reason}`);
}
console.log("Now run `pnpm i18n:build` and commit messages.yaml with src/generated.");
