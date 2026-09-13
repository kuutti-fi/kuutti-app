import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One entry of drizzle-kit's meta/_journal.json. `when` is the folder timestamp in ms. */
export type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

/** Returns null when the migrations folder has no journal yet (no migration generated). */
export function readJournal(migrationsFolder: string): JournalEntry[] | null {
  const path = join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: JournalEntry[] };
  return parsed.entries ?? [];
}
