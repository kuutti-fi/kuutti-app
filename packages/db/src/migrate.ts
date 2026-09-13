import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { readJournal } from "./journal.ts";
import { migrationsStatus } from "./migrations.ts";
import type { Pool } from "./pool.ts";

/** One advisory lock for every process that may migrate the same database. */
export const MIGRATE_LOCK_KEY = 725_121_113;

export type MigrateResult = {
  state: "no-journal" | "nothing-to-do" | "applied";
  applied: number;
};

/**
 * Applies committed migrations under a session-level advisory lock, so two
 * containers starting at once (a redeploy overlapping the old one) apply each
 * migration exactly once. Rule 10: migrations are generated, never hand-written,
 * and applied by the entrypoint before the server listens.
 */
export async function migrate(pool: Pool, migrationsFolder: string): Promise<MigrateResult> {
  if (readJournal(migrationsFolder) === null) return { state: "no-journal", applied: 0 };

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);
    const before = (await migrationsStatus(client, migrationsFolder)).applied;
    await drizzleMigrate(drizzle(client), { migrationsFolder });
    const after = (await migrationsStatus(client, migrationsFolder)).applied;
    const applied = after - before;
    return { state: applied > 0 ? "applied" : "nothing-to-do", applied };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
