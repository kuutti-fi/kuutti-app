/**
 * `pnpm --filter mobile check:contrast` (#12): WCAG contrast for every pair in
 * every token set of src/theme/tokens.css. Exits 1 with the failing pairs, so
 * CI keeps a token below the line off main.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkContrast, parseTokenSets } from "../src/theme/contrast.ts";

const file = resolve(import.meta.dirname, "..", "src", "theme", "tokens.css");
const sets = parseTokenSets(readFileSync(file, "utf8"));
const names = Object.keys(sets);
if (names.length === 0) {
  console.error(`check-contrast: no token sets found in ${file}`);
  process.exit(1);
}

const failures = checkContrast(sets);
for (const f of failures) {
  console.error(
    `✖ ${f.set}: --${f.foreground} on --${f.background} is ${f.ratio.toFixed(2)}:1, needs ${f.required}:1`,
  );
}
if (failures.length > 0) process.exit(1);
console.log(`✔ check-contrast: ${names.length} token sets (${names.join(", ")}) meet WCAG AA`);
