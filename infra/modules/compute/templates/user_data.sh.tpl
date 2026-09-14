#!/bin/bash
# First boot of the ${hostname} API box (#7). Runs once as root under cloud-init;
# later edits to this file do not touch a running box (lifecycle in main.tf).
# Nothing secret is in here: user_data is readable by anyone who can describe
# the instance.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

hostnamectl set-hostname "${hostname}"

# The subnet hands out no public address; there is no route out until the
# Elastic IP association lands, a few seconds after launch. Wait for it.
token=$(curl -sS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 600')
for _ in $(seq 1 60); do
  if curl -sSf -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/public-ipv4 >/dev/null; then break; fi
  sleep 5
done

# Security updates apply themselves; reboots are never automatic on a box that
# runs the only copy of the API.
apt-get update -q
apt-get install -y -q unattended-upgrades postgresql-client jq
systemctl enable --now unattended-upgrades

# AWS CLI for the backup job (the SSM agent ships with the Ubuntu AMI). snapd
# refuses installs until the device is seeded, which can be after cloud-init
# starts.
snap wait system seed.loaded
snap install aws-cli --classic

# Docker reads this at its first start, before Dokploy's installer creates a
# single container: every container logs to CloudWatch, one stream per name.
# Docker's dual logging keeps `docker logs` (and Dokploy's log view) working.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "awslogs",
  "log-opts": {
    "awslogs-region": "${region}",
    "awslogs-group": "${log_group}",
    "awslogs-create-group": "false",
    "tag": "{{.Name}}"
  }
}
JSON

# Dokploy. The installer is downloaded and checked against the hash of the
# copy vendored in this module, so a changed script fails the boot instead of
# running as root; the release tag pins the dokploy/dokploy image. The
# installer brings Docker, initialises a one-node swarm, and starts Dokploy,
# its Postgres and Traefik. The UI on port 3000 is never opened in the
# security group: reach it through Session Manager port forwarding (README).
curl -fsSL https://dokploy.com/install.sh -o /root/dokploy-install.sh
echo "${dokploy_installer_sha256}  /root/dokploy-install.sh" | sha256sum -c -
DOKPLOY_VERSION="${dokploy_version}" sh /root/dokploy-install.sh

# Nightly backup of Dokploy's state: /etc/dokploy (Traefik configuration and
# certificates, application definitions) plus a dump of Dokploy's own
# database, which lives in a Docker volume. Only that database is dumped, not
# roles, so a restore never overwrites the fresh box's generated Postgres
# password. One PutObject with SSE-KMS keeps the object unreadable to the plan
# role.
cat > /usr/local/bin/dokploy-backup <<'SH'
#!/bin/bash
set -euo pipefail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
container=$(docker ps -q --filter name=dokploy-postgres | head -n1)
docker exec "$container" pg_dump --clean --if-exists -U dokploy dokploy > "$work/dokploy-db.sql"
tar -C / -czf "$work/dokploy-$stamp.tgz" etc/dokploy -C "$work" dokploy-db.sql
aws s3api put-object --region "${region}" --bucket "${backup_bucket}" \
  --key "${backup_prefix}dokploy-$stamp.tgz" --body "$work/dokploy-$stamp.tgz" \
  --server-side-encryption aws:kms >/dev/null
SH
chmod 0755 /usr/local/bin/dokploy-backup
cat > /etc/cron.d/dokploy-backup <<'CRON'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
17 2 * * * root /usr/local/bin/dokploy-backup >> /var/log/dokploy-backup.log 2>&1
CRON
