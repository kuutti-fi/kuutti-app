/**
 * `pnpm i18n:build`: messages.yaml to src/generated (#13). The output is
 * committed, like the OpenAPI types (ADR-003), and CI fails when it drifts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkMessages } from "./lib/check.ts";
import { compile } from "./lib/compile.ts";
import { parseMessages } from "./lib/schema.ts";

const root = resolve(import.meta.dirname, "..");
const messages = parseMessages(readFileSync(resolve(root, "messages.yaml"), "utf8"));

// A file that breaks the rules does not compile: nobody ships from a bad source.
const { errors } = checkMessages(messages, { release: false });
if (errors.length > 0) {
  for (const error of errors) console.error(`✖ ${error}`);
  process.exit(1);
}

const out = resolve(root, "src", "generated");
mkdirSync(out, { recursive: true });
for (const [file, content] of Object.entries(compile(messages))) {
  writeFileSync(resolve(out, file), content);
}
console.log(`✔ i18n:build: ${Object.keys(messages).length} keys to src/generated`);
