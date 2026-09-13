import { randomBytes } from "node:crypto";
import { createPool } from "../pool.ts";

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
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
}
