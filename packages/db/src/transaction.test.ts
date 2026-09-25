import { afterAll, describe, expect, it } from "vitest";
import { createPool, transaction } from "./index.ts";

// The unit-of-work seam (#49): commit, rollback on a throw, and a savepoint
// when the caller is already inside a transaction, which is how every route
// runs under the API's test harness.

const URL = process.env.DATABASE_URL ?? "postgres://kuutti:kuutti@127.0.0.1:5432/kuutti_test";
const pool = createPool({ connectionString: URL, max: 2, applicationName: "kuutti-db-test" });
afterAll(() => pool.end());

describe("transaction", () => {
  it("commits on a pool, rolls back when the function throws", async () => {
    await pool.query("CREATE TEMP TABLE IF NOT EXISTS tx_probe (n int)");
    // A temp table is per connection; use a real one for the pool case.
    await pool.query("CREATE TABLE IF NOT EXISTS tx_probe_pool (n int)");
    try {
      await transaction(pool, async (tx) => {
        await tx.query("INSERT INTO tx_probe_pool VALUES (1)");
      });
      await expect(
        transaction(pool, async (tx) => {
          await tx.query("INSERT INTO tx_probe_pool VALUES (2)");
          throw new Error("no");
        }),
      ).rejects.toThrow("no");
      const { rows } = await pool.query<{ n: number }>("SELECT n FROM tx_probe_pool ORDER BY n");
      expect(rows.map((r) => r.n)).toEqual([1]);
    } finally {
      await pool.query("DROP TABLE IF EXISTS tx_probe_pool");
    }
  });

  it("is a savepoint inside an open transaction: an inner failure keeps the outer work", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE tx_probe_sp (n int) ON COMMIT DROP");
      await client.query("INSERT INTO tx_probe_sp VALUES (1)");
      await expect(
        transaction(client, async (tx) => {
          await tx.query("INSERT INTO tx_probe_sp VALUES (2)");
          throw new Error("inner");
        }),
      ).rejects.toThrow("inner");
      await transaction(client, async (tx) => {
        await tx.query("INSERT INTO tx_probe_sp VALUES (3)");
      });
      const { rows } = await client.query<{ n: number }>("SELECT n FROM tx_probe_sp ORDER BY n");
      expect(rows.map((r) => r.n)).toEqual([1, 3]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
