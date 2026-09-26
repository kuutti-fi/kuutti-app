-- Custom SQL migration file, put your code below! --
-- The research events table (#50, TD-5, ADR-011; rules/db.md): append-only,
-- monthly partitions, 90-day retention, keyed by research_id and never by
-- account_id. Drizzle's DSL cannot express PARTITION BY, hence this custom
-- migration (rule 10). The partitions themselves (events_YYYY_MM) are created
-- ahead by the API at boot and nightly (apps/api/src/research/partitions.ts);
-- retention is a DROP of a whole partition. No row is ever updated or deleted,
-- and the triggers below refuse the attempt, as on audit_log (0006). There is
-- no foreign key to research_subject: the events outlive the mapping row,
-- unlinkable once it is gone. pond is null for an event before the person
-- chose one; the API accepts the onboarding answers in any order (ADR-010 §9).
CREATE TABLE "events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "at" timestamp with time zone NOT NULL,
  "name" text NOT NULL,
  "research_id" uuid NOT NULL,
  "consent_version" text NOT NULL,
  "pond" text,
  "age_band" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "props" jsonb NOT NULL,
  PRIMARY KEY ("at", "id")
) PARTITION BY RANGE ("at");--> statement-breakpoint
CREATE INDEX "events_research_id_at_idx" ON "events" ("research_id", "at");--> statement-breakpoint
CREATE INDEX "events_name_at_idx" ON "events" ("name", "at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only: % refused', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
-- A row trigger on a partitioned table is cloned onto every partition, present and future.
CREATE TRIGGER events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION events_immutable();--> statement-breakpoint
-- TRUNCATE fires no row trigger; this one guards the statement on the parent.
CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON "events"
  FOR EACH STATEMENT EXECUTE FUNCTION events_immutable();
