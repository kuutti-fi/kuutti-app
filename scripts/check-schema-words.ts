/**
 * check-schema-words: the database never gets a column for what the project
 * promised not to store (rules 1 and 3, TD-1, TD-14): the personal identity
 * code, legal sex, a full date of birth, a name from the bank.
 *
 * Scans the committed migrations and the Drizzle schema for forbidden
 * identifiers as whole words. Exit 1 with every hit.
 *
 * Usage: node scripts/check-schema-words.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN = ["packages/db/drizzle", "packages/db/src/schema"];
const FORBIDDEN = [
  "hetu",
  "personal_identity_code",
  "personalidentitycode",
  "ssn",
  "legal_sex",
  "legalsex",
  "sex",
  "birth_day",
  "birthday",
  "birth_date",
  "birthdate",
  "date_of_birth",
  "dateofbirth",
  "dob",
  "full_name",
  "first_name",
  "last_name",
  "legal_name",
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(sql|ts|json)$/.test(entry)) out.push(path);
  }
  return out;
}

const pattern = new RegExp(`(?<![A-Za-z0-9_])(${FORBIDDEN.join("|")})(?![A-Za-z0-9_])`, "gi");
const hits: string[] = [];
for (const file of SCAN.flatMap((d) => walk(join(ROOT, d)))) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
    for (const m of line.matchAll(pattern)) {
      hits.push(`${relative(ROOT, file)}:${i + 1}: "${m[1]}" in: ${line.trim()}`);
    }
  });
}

if (hits.length > 0) {
  console.error("✖ forbidden identifiers in the database schema (rules 1 and 3):");
  for (const h of hits) console.error(`  ${h}`);
  process.exitCode = 1;
} else {
  console.log("✔ no forbidden identifiers in migrations or schema");
}
