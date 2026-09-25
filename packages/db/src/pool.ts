import pg from "pg";

/** Anything that can run a query: a Pool, or a checked-out Client inside a transaction. */
export type Queryable = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
};

export type PoolOptions = {
  connectionString: string;
  max?: number;
  applicationName?: string;
  connectionTimeoutMillis?: number;
};

/** One pool per process (TD-19: no RDS Proxy, no pooler). */
export function createPool(options: PoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "kuutti",
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
  });
}

/**
 * One unit of work: a transaction on a Pool, a savepoint on a client that is
 * already inside one (the test harness hands routes a client inside BEGIN, so
 * the same code runs in both; a bare client outside a transaction gets the
 * SAVEPOINT error, 25P01). Rolled back when `fn` throws.
 */
export async function transaction<T>(db: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (db instanceof pg.Pool) {
    const client = await db.connect();
    // A connection whose rollback failed is discarded, never returned to the pool.
    let dead = false;
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        dead = true;
      });
      throw error;
    } finally {
      client.release(dead);
    }
  }
  const savepoint = `sp_${Math.random().toString(36).slice(2, 10)}`;
  await db.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await fn(db);
    await db.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
    throw error;
  }
}

export type { Pool, PoolClient } from "pg";
