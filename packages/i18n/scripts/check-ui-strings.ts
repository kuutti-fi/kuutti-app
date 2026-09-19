/**
 * Part of `pnpm lint` (#13): no user-facing string literal in the clients'
 * TSX. Every such string is a key of messages.yaml, rendered through t().
 * Tests are exempt (they assert on rendered text), and so is this package.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { findUiStrings } from "./lib/ui-strings.ts";

const repo = resolve(import.meta.dirname, "..", "..", "..");
const ROOTS = ["apps/mobile/app", "apps/mobile/src", "apps/admin/src"];
const annotate = process.env.GITHUB_ACTIONS === "true";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "test" ? [] : tsxFiles(path);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
  });
}

let count = 0;
let files = 0;
for (const root of ROOTS) {
  for (const path of tsxFiles(join(repo, root))) {
    files++;
    const file = relative(repo, path);
    for (const hit of findUiStrings(file, readFileSync(path, "utf8"))) {
      count++;
      const message = `inline string ${JSON.stringify(hit.text)} (${hit.where}): add a key to packages/i18n/messages.yaml and use t()`;
      console.error(
        annotate
          ? `::error file=${file},line=${hit.line},col=${hit.column}::${message}`
          : `✖ ${file}:${hit.line}:${hit.column} ${message}`,
      );
    }
  }
}
if (count > 0) process.exit(1);
console.log(`✔ check:ui-strings: ${files} files, no inline user-facing strings`);
