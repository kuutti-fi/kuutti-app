import { resolve } from "node:path";
import { createPool, migrate } from "@kuutti/db";
import { ensureEventPartitions } from "../research/index.ts";

/** Runs once per test run: the test database carries every committed migration and, as after a boot, this month's and next month's events partitions. */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "postgres://kuutti:kuutti@127.0.0.1:5432/kuutti_test";
  const pool = createPool({
    connectionString: url,
    max: 1,
    applicationName: "kuutti-api-test-setup",
  });
  try {
    await migrate(
      pool,
      resolve(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "drizzle"),
    );
    await ensureEventPartitions(pool, new Date());
  } finally {
    await pool.end();
  }
}
