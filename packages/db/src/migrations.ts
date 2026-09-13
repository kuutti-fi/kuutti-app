import { readJournal } from "./journal.ts";
import type { Queryable } from "./pool.ts";

export type MigrationsStatus = {
  state: "current" | "pending";
  applied: number;
  pending: string[];
};

/**
 * Compares the committed journal with drizzle.__drizzle_migrations. Mirrors the
 * migrator's own rule: an entry is pending when its folder timestamp is newer
 * than the last applied migration. No journal means nothing to apply.
 */
export async function migrationsStatus(
  db: Queryable,
  migrationsFolder: string,
): Promise<MigrationsStatus> {
  const journal = readJournal(migrationsFolder) ?? [];
  if (journal.length === 0) return { state: "current", applied: 0, pending: [] };

  const table = await db.query<{ present: boolean }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
  );
  if (!table.rows[0]?.present) {
    return { state: "pending", applied: 0, pending: journal.map((e) => e.tag) };
  }
  const last = await db.query<{ created_at: string | number }>(
    "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
  );
  const lastApplied = Number(last.rows[0]?.created_at ?? 0);
  const pending = journal.filter((e) => e.when > lastApplied).map((e) => e.tag);
  return {
    state: pending.length > 0 ? "pending" : "current",
    applied: journal.length - pending.length,
    pending,
  };
}
