-- The audit boundary (#49, ADR-006, security checklist line 67): audit_log
-- and its trigger function belong to a role the API never connects as, so the
-- application role can neither rewrite rows nor disable the trigger that
-- refuses UPDATE, DELETE and TRUNCATE (only the owner may ALTER TABLE ...
-- DISABLE TRIGGER, or CREATE OR REPLACE the function). The schema goes with
-- it: its owner may drop any table in it, and the application role owned it
-- as the database's owner; it keeps CREATE and USAGE, which is all a
-- migration needs. Written for the RDS master role, which is not a superuser:
-- the executor becomes a member of the audit role with SET
-- (createrole_self_grant). Idempotent.
-- __APP_ROLE__ and __AUDIT_ROLE__ are substituted by db-audit-owner.sh
-- (kuutti_app, kuutti_audit); packages/db/src/audit-owner.test.ts runs this
-- file as a non-superuser in the master's position on a fresh database.
SET createrole_self_grant = 'set, inherit';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '__AUDIT_ROLE__') THEN
    CREATE ROLE __AUDIT_ROLE__ NOLOGIN;
  END IF;
END
$$;
ALTER SCHEMA public OWNER TO __AUDIT_ROLE__;
GRANT CREATE, USAGE ON SCHEMA public TO __APP_ROLE__;
ALTER TABLE public.audit_log OWNER TO __AUDIT_ROLE__;
ALTER FUNCTION public.audit_log_immutable() OWNER TO __AUDIT_ROLE__;
REVOKE ALL ON public.audit_log FROM __APP_ROLE__;
GRANT SELECT, INSERT ON public.audit_log TO __APP_ROLE__;
-- Fire under every replication role too (a superuser session in replica mode
-- is the one thing the owner script cannot otherwise reach).
ALTER TABLE public.audit_log ENABLE ALWAYS TRIGGER audit_log_no_update_or_delete;
ALTER TABLE public.audit_log ENABLE ALWAYS TRIGGER audit_log_no_truncate;
