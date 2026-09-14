#!/usr/bin/env bash
# Creates the application role on a fresh RDS instance and stores its password
# as /kuutti/<env>/db-app-password (SecureString, TD-19). Run once per
# environment from the maintainer's machine; RDS is private, so the connection
# goes through a Session Manager port forward on the API box. Nothing is
# printed except progress; the master password stays in this process.
#
#   infra/scripts/db-app-role.sh staging
#
# Needs: aws (signed in with admin), tofu, psql, jq, and the Session Manager
# plugin (brew install --cask session-manager-plugin).
set -euo pipefail

env="${1:?usage: db-app-role.sh <staging|prod>}"
case "$env" in staging|prod) ;; *) echo "environment must be staging or prod" >&2; exit 2 ;; esac

repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo/infra/envs/$env"
instance=$(tofu output -raw instance_id)
host=$(tofu output -raw db_host)
secret=$(tofu output -raw db_master_secret_arn)
param="/kuutti/$env/db-app-password"
local_port=15432

if aws ssm get-parameter --name "$param" >/dev/null 2>&1; then
  echo "$param already exists; refusing to overwrite. Delete it first if the role must be recreated." >&2
  exit 1
fi

echo "port forward to $host through $instance"
aws ssm start-session --target "$instance" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$host,portNumber=5432,localPortNumber=$local_port" >/dev/null &
tunnel=$!
trap 'kill "$tunnel" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  if (echo > "/dev/tcp/127.0.0.1/$local_port") 2>/dev/null; then break; fi
  sleep 1
done

master_password=$(aws secretsmanager get-secret-value --secret-id "$secret" --query SecretString --output text | jq -r .password)
conn="host=127.0.0.1 port=$local_port dbname=kuutti user=kuutti_admin sslmode=require"

# A CREATE ROLE that fails is logged by Postgres with its statement, password
# included, so make sure it cannot fail.
if [ "$(PGPASSWORD="$master_password" psql -tAq "$conn" -c "SELECT 1 FROM pg_roles WHERE rolname = 'kuutti_app'")" = "1" ]; then
  echo "role kuutti_app already exists but $param does not; rotate with ALTER ROLE and put-parameter instead" >&2
  exit 1
fi
app_password=$(openssl rand -hex 24)

echo "creating role kuutti_app and handing it the kuutti database"
PGPASSWORD="$master_password" psql -v ON_ERROR_STOP=1 -q "$conn" <<SQL
CREATE ROLE kuutti_app LOGIN PASSWORD '$app_password';
GRANT kuutti_app TO kuutti_admin;
ALTER DATABASE kuutti OWNER TO kuutti_app;
SQL

echo "storing $param"
aws ssm put-parameter --name "$param" --type SecureString --value "$app_password" \
  --description "Password of the kuutti_app role; created by infra/scripts/db-app-role.sh" >/dev/null
echo "done: the API on $env composes DATABASE_URL from db-host, db-name, db-user and this parameter"
