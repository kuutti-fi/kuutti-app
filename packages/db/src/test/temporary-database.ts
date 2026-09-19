import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createPool, type Queryable } from "../pool.ts";

/** Local default matches docker compose (#5) and the CI service container; never a secret. */
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://kuutti:kuutti@127.0.0.1:5432/kuutti_test";

/**
 * A fresh, empty database for tests that exercise migrations or seeding end to
 * end, dropped afterwards. Needs CREATEDB on the test role, which compose and
 * the CI service grant.
 */
export async function withTemporaryDatabase<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const name = `kuutti_tmp_${randomBytes(6).toString("hex")}`;
  const admin = createPool({
    connectionString: TEST_DATABASE_URL,
    max: 1,
    applicationName: "kuutti-tmpdb",
  });
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  try {
    return await fn(url.toString());
  } finally {
    await sessionsClosed(admin, name);
    // Only what a test leaked is left by now.
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
}

/**
 * Waits, for at most two seconds, until nobody is connected to the database.
 * pg-pool resolves `pool.end()` before its clients' sockets have closed and
 * has already taken its error listener off them; terminating such a backend
 * makes its FATAL 57P01 an uncaught exception in the test run (seen under
 * load, one run in a few). Sessions that are leaving are left to leave.
 */
async function sessionsClosed(admin: Queryable, name: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const open = await admin.query<{ n: string }>(
      "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = $1",
      [name],
    );
    if (Number(open.rows[0]?.n) === 0) return;
    await sleep(20);
  }
}
