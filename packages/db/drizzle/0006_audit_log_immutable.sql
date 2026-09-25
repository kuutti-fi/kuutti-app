-- Custom SQL migration file, put your code below! --
-- audit_log is append-only (TD-5, security checklist "immutable audit table",
-- #49): the application role owns the table, so a grant cannot stop it from
-- rewriting rows; a trigger refuses UPDATE, DELETE and TRUNCATE, and dropping
-- it is a migration that goes through review. What a trigger cannot stop is
-- the owner disabling it (ALTER TABLE ... DISABLE TRIGGER); a separate owner
-- role with UPDATE, DELETE and TRUNCATE revoked from kuutti_app is the M4
-- step that closes that (ADR-006). Nothing in the schema DSL expresses a trigger, hence
-- this drizzle-kit custom migration (rule 10: generated, not hand-written in
-- the sense of bypassing the tool; the SQL is the one thing it cannot derive).
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();--> statement-breakpoint
-- TRUNCATE fires no row trigger; it needs its own, statement-level one.
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
