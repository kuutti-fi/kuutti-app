-- The boundary's counterpart: hands audit_log and its trigger function back to
-- the application role for the length of one deploy, because migrations run as
-- that role and one that touches audit_log would otherwise fail (and with it
-- the whole batch, and the boot). Sequence: release, deploy, apply the owner
-- script again. db-audit-owner.sh <env> release.
ALTER TABLE public.audit_log OWNER TO __APP_ROLE__;
ALTER FUNCTION public.audit_log_immutable() OWNER TO __APP_ROLE__;
