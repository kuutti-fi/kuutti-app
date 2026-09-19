/**
 * `pnpm i18n:check [--release]`: the CI job (#13). Missing Finnish fails,
 * missing Swedish warns, a banned inflection fails, and with --release (a v*
 * tag) Finnish that is still machine-translated fails.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkMessages, unreviewed } from "./lib/check.ts";
import { parseMessages } from "./lib/schema.ts";

const release = process.argv.includes("--release");
const annotate = process.env.GITHUB_ACTIONS === "true";

let messages: ReturnType<typeof parseMessages>;
try {
  messages = parseMessages(
    readFileSync(resolve(import.meta.dirname, "..", "messages.yaml"), "utf8"),
  );
} catch (error) {
  console.error(`✖ ${(error as Error).message}`);
  process.exit(1);
}

const { errors, warnings } = checkMessages(messages, { release });
for (const warning of warnings) console.log(annotate ? `::warning::${warning}` : `! ${warning}`);
for (const error of errors) console.error(annotate ? `::error::${error}` : `✖ ${error}`);

const machineFi = unreviewed(messages, "fi").length;
console.log(
  `${errors.length === 0 ? "✔" : "✖"} i18n:check${release ? " --release" : ""}: ` +
    `${Object.keys(messages).length} keys, ${errors.length} errors, ${warnings.length} warnings, ` +
    `${machineFi} Finnish texts awaiting a native review`,
);
if (errors.length > 0) process.exit(1);
