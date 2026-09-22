import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrate.ts";
import { createPool } from "./pool.ts";
import { withTemporaryDatabase } from "./test/temporary-database.ts";

const MIGRATIONS = resolve(import.meta.dirname, "..", "drizzle");

describe("identity and account tables", () => {
  it("allow at most one live account per identity, at the database (#34)", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        await migrate(pool, MIGRATIONS);
        const { rows } = await pool.query<{ id: string }>(
          "INSERT INTO identity (hetu_hmac) VALUES ($1) RETURNING id",
          ["f".repeat(64)],
        );
        const identityId = rows[0]?.id;
        const insert = (state: string) =>
          pool.query(
            "INSERT INTO account (identity_id, state, birth_year, birth_month) VALUES ($1, $2, 1990, 1)",
            [identityId, state],
          );
        await insert("deleted");
        await insert("active");
        await expect(insert("registered")).rejects.toMatchObject({ code: "23505" });
        const live = await pool.query<{ n: string }>(
          "SELECT count(*) AS n FROM account WHERE identity_id = $1 AND state <> 'deleted'",
          [identityId],
        );
        expect(Number(live.rows[0]?.n)).toBe(1);
      } finally {
        await pool.end();
      }
    });
  });
});
