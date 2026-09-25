#!/usr/bin/env bash
# Moves audit_log and its trigger function to the kuutti_audit role, so the
# application role can only read and append (#49, ADR-006, security checklist
# line 67). Run from the maintainer's machine after the first deploy that
# created the table. Before a deploy whose migrations touch audit_log, run it
# with `release` (ownership back to kuutti_app for that deploy), then again
# without. The API logs "audit boundary" at boot with enforced: true|false.
#
#   infra/scripts/db-audit-owner.sh staging
#   infra/scripts/db-audit-owner.sh staging release
#
# Same tunnel and credentials as db-app-role.sh; nothing is printed but progress.
set -euo pipefail
env="${1:?usage: db-audit-owner.sh <staging|prod> [release]}"
mode="${2:-apply}"
for tool in aws tofu psql jq session-manager-plugin; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is not installed" >&2; exit 1; }
done
case "$env" in staging|prod) ;; *) echo "environment must be staging or prod" >&2; exit 2 ;; esac
case "$mode" in apply|release) ;; *) echo "second argument is 'release' or nothing" >&2; exit 2 ;; esac
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo/infra/envs/$env"
instance=$(tofu output -raw instance_id)
host=$(tofu output -raw db_host)
secret=$(tofu output -raw db_master_secret_arn)
local_port=15433
echo "port forward to $host through $instance"
aws ssm start-session --target "$instance" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$host,portNumber=5432,localPortNumber=$local_port" >/dev/null &
tunnel=$!
trap 'pkill -P "$tunnel" 2>/dev/null; kill "$tunnel" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  if (echo > "/dev/tcp/127.0.0.1/$local_port") 2>/dev/null; then break; fi
  sleep 1
done
master_password=$(aws secretsmanager get-secret-value --secret-id "$secret" --query SecretString --output text | jq -r .password)
conn="host=$host hostaddr=127.0.0.1 port=$local_port dbname=kuutti user=kuutti_admin sslmode=verify-full sslrootcert=$repo/apps/api/certs/rds-eu-central-1-bundle.pem"
if [ "$(PGPASSWORD="$master_password" psql -tAq "$conn" -c "SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_log'")" != "1" ]; then
  echo "audit_log does not exist yet on $env: deploy the migration first" >&2
  exit 1
fi
if [ "$mode" = "release" ]; then
  echo "handing audit_log back to kuutti_app for one deploy; run this script again afterwards"
  file="$repo/infra/scripts/db-audit-release.sql"
else
  echo "moving audit_log to the kuutti_audit role; kuutti_app keeps SELECT and INSERT"
  file="$repo/infra/scripts/db-audit-owner.sql"
fi
sed -e 's/__APP_ROLE__/kuutti_app/g' -e 's/__AUDIT_ROLE__/kuutti_audit/g' "$file" \
  | PGPASSWORD="$master_password" psql -v ON_ERROR_STOP=1 -q "$conn"
echo "done: the API logs \"audit boundary\" at its next boot"
