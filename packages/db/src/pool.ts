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

export type { Pool, PoolClient } from "pg";
