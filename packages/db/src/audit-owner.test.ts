import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrate.ts";
import { createPool } from "./pool.ts";
import { withTemporaryDatabase } from "./test/temporary-database.ts";

// The audit boundary (#49, ADR-006): infra/scripts/db-audit-owner.sql, run
// exactly as on RDS — by a non-superuser master role that is a member of the
// application role, against a database the application role owns — leaves the
// application role able to append to and read audit_log and nothing else, and
// unable to disable the trigger or replace its function. The release file
// hands ownership back for a deploy. Needs a superuser on the test database to
// stage the roles (the compose Postgres); skipped elsewhere.

const SCRIPTS = resolve(import.meta.dirname, "../../../infra/scripts");
const OWNER_SQL = readFileSync(resolve(SCRIPTS, "db-audit-owner.sql"), "utf8");
const RELEASE_SQL = readFileSync(resolve(SCRIPTS, "db-audit-release.sql"), "utf8");
const MIGRATIONS = resolve(import.meta.dirname, "../drizzle");

const fill = (sql: string, app: string, audit: string) =>
  sql.replaceAll("__APP_ROLE__", app).replaceAll("__AUDIT_ROLE__", audit);
const as = (url: string, role: string) =>
  createPool({ connectionString: url.replace(/\/\/[^@]+@/, `//${role}:probe@`), max: 1 });

describe("audit_log boundary", () => {
  it("applied by the master role, leaves the application role with INSERT and SELECT and no way around the trigger", async () => {
    await withTemporaryDatabase(async (url) => {
      const su = createPool({ connectionString: url, max: 2 });
      const isSuper = (
        await su.query<{ rolsuper: boolean }>(
          "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
        )
      ).rows[0]?.rolsuper;
      if (!isSuper) {
        await su.end();
        return;
      }
      const tag = Math.random().toString(36).slice(2, 8);
      const app = `probe_app_${tag}`;
      const master = `probe_admin_${tag}`;
      const audit = `probe_audit_${tag}`;
      const database = new URL(url).pathname.slice(1);
      await migrate(su, MIGRATIONS);
      // The RDS shape: the application role owns the database (hence the public
      // schema) and every table the migrations made; the master role is a
      // CREATEROLE member of it and not a superuser.
      await su.query(`CREATE ROLE ${app} LOGIN PASSWORD 'probe'`);
      await su.query(`CREATE ROLE ${master} LOGIN PASSWORD 'probe' NOSUPERUSER CREATEROLE`);
      await su.query(`GRANT ${app} TO ${master}`);
      await su.query(`ALTER DATABASE ${database} OWNER TO ${app}`);
      await su.query(`DO $$ DECLARE r record; BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
          EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, '${app}');
        END LOOP; END $$`);
      await su.query(`ALTER FUNCTION public.audit_log_immutable() OWNER TO ${app}`);
      const actor =
        (
          await su.query<{ id: string }>(
            "INSERT INTO identity (hetu_hmac) VALUES ('probe-actor') RETURNING id",
          )
        ).rows[0]?.id ?? "";

      const asMaster = as(url, master);
      const asApp = as(url, app);
      try {
        await asMaster.query(fill(OWNER_SQL, app, audit));
        const owners = await su.query<{ t: string; f: string }>(
          `SELECT (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.audit_log'::regclass) AS t,
                  (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.audit_log_immutable()'::regprocedure) AS f`,
        );
        expect(owners.rows[0]).toEqual({ t: audit, f: audit });

        await asApp.query(
          "INSERT INTO audit_log (actor_identity_id, action, subject_type, subject_id) VALUES ($1, 'probe', 'photo', $1)",
          [actor],
        );
        expect((await asApp.query("SELECT count(*) AS n FROM audit_log")).rows[0]?.n).toBe("1");
        for (const statement of [
          "UPDATE audit_log SET action = 'x'",
          "DELETE FROM audit_log",
          "TRUNCATE audit_log",
          "ALTER TABLE audit_log DISABLE TRIGGER ALL",
          "CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$",
          "DROP TABLE audit_log",
          "DROP SCHEMA public CASCADE",
          "ALTER SCHEMA public OWNER TO CURRENT_USER",
        ]) {
          await expect(asApp.query(statement), statement).rejects.toMatchObject({ code: "42501" });
        }
        // A migration still creates and drops its own tables in the schema.
        await asApp.query("CREATE TABLE public.probe_table (n int)");
        await asApp.query("DROP TABLE public.probe_table");
        // The owner side still refuses rewrites: the trigger, not a grant, is the rule.
        await expect(asMaster.query("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
        // Applying it again changes nothing and fails nothing.
        await asMaster.query(fill(OWNER_SQL, app, audit));

        // The release hands it back for a deploy; a migration as the app role works again.
        await asMaster.query(fill(RELEASE_SQL, app, audit));
        await asApp.query("ALTER TABLE audit_log ADD COLUMN probe_column int");
        await asApp.query("ALTER TABLE audit_log DROP COLUMN probe_column");
        await asMaster.query(fill(OWNER_SQL, app, audit));
        await expect(
          asApp.query("ALTER TABLE audit_log DISABLE TRIGGER ALL"),
        ).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await asApp.end();
        await asMaster.end();
        await su.query(`ALTER DATABASE ${database} OWNER TO current_user`);
        // The database is dropped by the helper; the roles are cluster-wide and
        // must own nothing in it first (the audit role owns the schema by now).
        for (const role of [app, audit, master]) {
          await su.query(`DROP OWNED BY ${role} CASCADE`);
          await su.query(`DROP ROLE ${role}`);
        }
        await su.end();
      }
    });
  });
});
