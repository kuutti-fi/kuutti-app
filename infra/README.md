# Infrastructure

OpenTofu, AWS, one account, eu-central-1. See `docs/adr/001-infrastructure-as-code.md` for why, and `.claude/rules/infra.md` for the standing rules.

Commands below use `tofu`. Terraform is command-compatible if you have it instead, but the committed lockfile is OpenTofu's.

## Layout

| path | contents | when |
|---|---|---|
| `bootstrap/` | state bucket, GitHub OIDC provider, CI roles, budget and billing alarm | once, before anything else |
| `modules/` | `network`, `compute`, `data` (#7); media and email later | as milestones need them |
| `envs/staging`, `envs/prod` | one composition per environment: the three modules plus the non-secret parameters | M1 (#7) |
| `github/` | repository settings, branch protection, environments | not adopted; `gh api` below until the GitHub provider question is settled |

Modules arrive with the milestone that needs them: network, compute and data in M1 (#7); media and delivery in M3; email in M5. `scripts/` holds the one-time procedures that are deliberately not resources.

## Account, once (console, maintainer only)

Everything in this section is click-ops by design: it is the part ADR-001 allows, and it happens before any code can run. Do it in this order; the click-by-click version, including the stopgap mailbox while the project domain has no mail, is `docs/runbooks/aws-account-setup.md`.

1. **Create the account.** Root email is a re-pointable alias on the project domain, never a personal address (TD-4); until the domain has mail, a dedicated mailbox created for the project, re-pointed later from account settings. Account name `kuutti`. Set the billing, operations and security alternate contacts to project addresses too.
2. **Secure root.** Hardware MFA on root, no root access keys. `aws iam get-account-summary` must later show `AccountMFAEnabled: 1` and `AccountAccessKeysPresent: 0`.
3. **Paid account plan**, chosen at sign-up. Free-plan accounts close after six months or when the credits run out (TD-19), and enabling Identity Center (step 5) creates an organisation, which force-upgrades a free-plan account anyway and expires the sign-up credits on either plan. Billing must show no free-plan banner.
4. **Enable billing metrics.** Billing and Cost Management → Billing preferences → Alert preferences → *Receive CloudWatch Billing Alerts*. One-way switch; the metric appears about 15 minutes later. The bootstrap's billing alarm reads it.
5. **Admin access for the bootstrap apply.** **IAM Identity Center** (ADR-001, admin access): one user for the maintainer, one permission set (`AdministratorAccess`), MFA required by the identity store, sessions issued by `aws configure sso`. No IAM user and no long-lived access key ever exist. Enabling Identity Center creates an organisation with this account as its management account; see step 6 for what that means at transfer time. A single IAM user with MFA and console-issued session credentials is the fallback only if Identity Center cannot be enabled.
6. **Later, nothing to do now:** the account moves under an organisation owned by the association (TD-4). Because Identity Center made this account the management account of its own organisation, that move means deleting this one-account organisation and its Identity Center instance first, then accepting the association's invitation and re-creating admin access there (ADR-001). Root email and alternate contacts re-point; nothing under `infra/` changes.

## Tools

```sh
brew install opentofu awscli
aws configure sso
aws sts get-caller-identity
```

`aws configure sso` runs once; afterwards `aws sso login` renews the session.

Sign in from your own terminal. An agent working in this repository never types, reads or prints credentials and never opens `~/.aws/*`; it only runs `tofu` and `aws` commands that use the session you already hold.

## Bootstrap, run once

GitHub's immutable subject claims mean the trust policy keys on numeric IDs, not names. Get them:

```sh
gh api repos/kuutti-fi/kuutti-app --jq '{repo_id: .id, owner_id: .owner.id}'
```

Then:

```sh
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
tofu init
tofu apply
```

Fill in the two GitHub IDs and the billing alias in `terraform.tfvars` before the apply. This runs with local state, because the bucket it creates is where state will live. The apply also creates the monthly budget (TD-4: 50 EUR, expressed as `monthly_budget_usd` because the billing metric is USD-only), the CloudWatch billing alarm in us-east-1, and the SNS topic both notify. AWS mails a subscription confirmation to the billing alias: confirm it, then send the test notification:

```sh
aws sns publish --region us-east-1 --topic-arn "$(tofu output -raw billing_topic_arn)" \
  --subject 'kuutti billing test' --message 'delivery check'
```

Migrate the state immediately afterwards:

Put `tofu output -raw state_bucket` into the backend block of `versions.tf` and uncomment it, then:

```sh
tofu init -migrate-state
rm -f terraform.tfstate terraform.tfstate.backup
tofu plan
```

The plan must report no changes.

Commit `versions.tf` and `.terraform.lock.hcl`. The lockfile carries hashes for every platform the provider ships, so developer machines and both runner architectures init from it unchanged.

Later changes to `bootstrap/` are applied the same way, by the maintainer: it owns the CI roles, so CI cannot apply it.

`terraform.tfvars` and any `*.tfstate` are gitignored. The state bucket holds secrets: it is versioned, encrypted, public access is blocked, and only the CI roles and the maintainer can read it.

About 24 hours after the first apply the `Project` tag shows up in Cost Explorer; activate it as a cost allocation tag then (it cannot be activated before it has appeared in billing data, which is why it is not a resource here):

```sh
aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=Project,Status=Active
```

## After bootstrap: GitHub

The bootstrap outputs are not secret, so they go into repository **variables**. CI reads `vars.*`; no AWS credential exists in any repository or environment secret.

```sh
cd infra/bootstrap
gh variable set AWS_REGION --body eu-central-1
gh variable set TF_STATE_BUCKET --body "$(tofu output -raw state_bucket)"
gh variable set AWS_PLAN_ROLE_ARN --body "$(tofu output -raw ci_plan_role_arn)"
gh variable set AWS_APPLY_ROLE_ARN --body "$(tofu output -raw ci_apply_role_arn)"
gh variable set AWS_PERMISSIONS_BOUNDARY_ARN --body "$(tofu output -raw permissions_boundary_arn)"
```

The apply role trusts exactly two subjects, `environment:staging` and `environment:prod`, so the production approval lives in GitHub's environment protection, not in AWS. Create the environments with the same names (the GitHub Terraform provider is not adopted; `infra/github/` stays empty until that question is settled):

```sh
R=repos/kuutti-fi/kuutti-app
# staging: deployable from main only, no reviewers
gh api -X PUT "$R/environments/staging" --input - <<'JSON'
{"wait_timer":0,"reviewers":[],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST "$R/environments/staging/deployment-branch-policies" --input - <<'JSON'
{"name":"main","type":"branch"}
JSON

# prod: the maintainer approves, tags v* only
gh api -X PUT "$R/environments/prod" --input - <<'JSON'
{"wait_timer":0,"prevent_self_review":false,"reviewers":[{"type":"User","id":9991098}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST "$R/environments/prod/deployment-branch-policies" --input - <<'JSON'
{"name":"v*","type":"tag"}
JSON

# check
gh api "$R/environments" --jq '.environments[] | {name, rules: [.protection_rules[] | {type, reviewers: [.reviewers[]?.reviewer.login]}]}'
for e in staging prod; do gh api "$R/environments/$e/deployment-branch-policies" --jq ".branch_policies[] | \"$e: \\(.type) \\(.name)\""; done
```

`9991098` is the maintainer's user id (`gh api users/superseacat --jq .id`). `prevent_self_review` stays off while the maintainer is the only reviewer.

## Verify

`.github/workflows/infra-oidc.yml` keeps the two properties of the plan role proven on every infrastructure change: it is assumable from a pull request and from `main`, and it cannot decrypt a SecureString even though `ReadOnlyAccess` would allow it. It needs one throwaway parameter:

```sh
aws ssm put-parameter --name /kuutti/ci-check/secret --type SecureString --value not-a-secret
```

The environment gates are checked once, by dispatching the same workflow with the `gate` input: from a `v*` tag with `gate=prod` the job waits for the reviewer before assuming `kuutti-ci-apply`; from any branch other than `main` with `gate=staging` GitHub refuses the ref before the job starts. Delete the tag afterwards.

Done when: `aws iam get-account-summary` shows MFA on and no access keys; the test notification arrived; `tofu plan` in `bootstrap/` on the S3 backend shows no changes and no local state file exists; the workflow is green on a pull request with `AccessDenied` visible in the decrypt step; both gate checks behaved; `gh variable list` shows the five variables and `gh secret list` shows no AWS credential; Billing shows the paid plan.

## Environments

```sh
cd infra/envs/staging
tofu init
tofu plan
```

The same in `infra/envs/prod`. Applies run through CI (#8): plans on every pull request, staging on merge to `main`, production only after approval on the `prod` GitHub environment. A local plan needs the SSO session; a local apply is not the path.

Until the media module puts CloudFront in front (M3), TLS terminates at Traefik on the box and the API answers on the Elastic IP directly (#7).

Each environment composes the three modules (#7, TD-19):

| module | creates | notes |
|---|---|---|
| `network` | VPC /16, one public subnet, two private subnets, DB subnet group, `api` and `db` security groups | no NAT; `db` admits 5432 from the `api` group only; port 22 only for `ssh_cidrs`, empty by default |
| `data` | RDS PostgreSQL 17 single-AZ, gp3 20→100 GB, 35-day PITR, `rds.force_ssl=1`, Extended Support declined, master password held by AWS | staging `db.t4g.micro`, prod `db.t4g.small` with deletion protection and a final snapshot |
| `compute` | t4g.small Ubuntu 24.04 arm64, Elastic IP, IMDSv2, instance role `kuutti-api-<env>` under the boundary, log group `/kuutti/<env>/api`, first-boot script installing Dokploy | staging also owns the account-wide Session Manager preferences and `/kuutti/ssm-sessions` |

The composition then writes the non-secret parameters `app-env`, `log-level`, `db-host`, `db-port`, `db-name`, `db-user` under `/kuutti/<env>/`; the API turns them into `APP_ENV`, `DB_HOST` and so on at boot and composes `DATABASE_URL` with `sslmode=require`.

Every IAM role declared in an environment or module sets `permissions_boundary` to the bootstrap output `permissions_boundary_arn`; the apply role refuses to create a role without it. The plan role cannot read secrets, logs, or object data, only resource metadata and state.

### Cost

TD-4 budgets 50 EUR a month. One environment is roughly 30 EUR (instance, database, address, storage); both together are around 65 EUR, above the budget alert. Apply staging first and prod when there is something to release, or raise `monthly_budget_usd` in the bootstrap knowingly.

### After the first apply, once per environment

1. **Application role.** RDS is private, so the script tunnels through the box with Session Manager (`brew install --cask session-manager-plugin` once). It creates `kuutti_app`, makes it the owner of the `kuutti` database so migrations can run, and stores its password as `/kuutti/<env>/db-app-password`. The master password stays inside the script's process.

   ```sh
   infra/scripts/db-app-role.sh staging
   ```

2. **Dokploy.** The first boot installs Docker and Dokploy `v0.30.6` (variable `dokploy_version`) with the installer vendored at `modules/compute/vendor/`, verified by hash on the box. Port 3000 is never opened; reach the UI through a port forward, create the admin account, and keep its credentials in the password manager:

   ```sh
   aws ssm start-session --target "$(tofu output -raw instance_id)" --document-name AWS-StartPortForwardingSession --parameters portNumber=3000,localPortNumber=3000
   ```

   Then at `http://localhost:3000`: one project named after the environment, one application `api` deployed from the GHCR image (#8), domain `api.staging.<domain>` or `api.<domain>` with Let's Encrypt through Traefik, container port 3000. Application environment is exactly `NODE_ENV=production`, `APP_ENV=staging` (or `production`), `PORT=3000`; everything else comes from SSM through the instance role, never from Dokploy. DNS is not in this repository: an A record per API host name to `tofu output -raw public_ip`.

3. **Checks.** From the box (`aws ssm start-session --target <instance-id>`, shell `ssm-user`, `sudo -i` for root). Everything typed and printed in a session is streamed to `/kuutti/ssm-sessions`, so a secret must never be printed there; the forms below keep the value inside the shell:

   ```sh
   aws ssm get-parameter --name /kuutti/<other env>/db-host                     # must be refused
   PGPASSWORD="$(aws ssm get-parameter --name /kuutti/<env>/db-app-password --with-decryption --query Parameter.Value --output text)" \
     psql "host=$(aws ssm get-parameter --name /kuutti/<env>/db-host --query Parameter.Value --output text) dbname=kuutti user=kuutti_app sslmode=require" -c 'select 1'
   ```

   From your machine: `aws iam get-role --role-name kuutti-api-<env> --query Role.PermissionsBoundary` shows the boundary.

### Backups and rebuilding the box

The box is stateless except for Dokploy's own configuration, the one manual island of ADR-001. A cron job at 02:17 UTC tars `/etc/dokploy` (Traefik configuration and certificates, application definitions) together with a dump of Dokploy's database and uploads it with SSE-KMS to `s3://kuutti-tfstate-<account>/dokploy-backup/<env>/`. The plan role can list the bucket but is denied `kms:Decrypt`, so it cannot read these objects.

```sh
aws s3 ls s3://kuutti-tfstate-438298963814/dokploy-backup/staging/
```

Rebuild from scratch, tested once per the #7 checklist:

1. `tofu apply -replace=module.compute.aws_instance.api` in the environment. The Elastic IP moves with it; wait for `cloud-init status --wait` on the new box to report done (Dokploy is installed fresh).
2. On the new box (`aws ssm start-session`, then `sudo -i`) fetch the latest backup; the instance role may read its own prefix: `aws s3 cp s3://kuutti-tfstate-<account>/dokploy-backup/<env>/dokploy-<stamp>.tgz /root/backup.tgz`.
3. Still on the box: `docker service scale dokploy=0`, `tar -C / -xzf /root/backup.tgz etc/dokploy`, then the database into the fresh container (the dump holds only the `dokploy` database, so the container's generated password survives): `tar -C /root -xzf /root/backup.tgz dokploy-db.sql`, `c=$(docker ps -q --filter name=dokploy-postgres)`, `docker exec -i "$c" psql -U dokploy -d dokploy < /root/dokploy-db.sql`, finally `docker service scale dokploy=1`.
4. Redeploy the application from Dokploy; certificates come back with `/etc/dokploy/traefik`.

A newer AMI or an edited first-boot script never replaces a running box on its own (`ignore_changes`); rebuilding is always the explicit `-replace` above.

## Secrets

Secret parameters are not resources in this code: the AWS provider would store the decrypted value in state on every refresh, and `ignore_changes` only hides the diff. Create them once, out of band, and reference them by path in the instance-role policy. Reserved paths, `<env>` being `staging` or `prod`:

| path | read by | created in |
|---|---|---|
| `/kuutti/<env>/hetu-hmac-key` | API at boot; HMAC-SHA256 of the hetu (rules 1 and 2) | M2 |
| `/kuutti/<env>/telia-signing-key` | API; the Telia OIDC exchange | M2 |
| `/kuutti/<env>/cloudfront-signing-key` | API; signed media URLs | M3 |
| `/kuutti/<env>/db-app-password` | API; its own database role | #7 |
| `/kuutti/ci-check/secret` | nothing; proves the plan role cannot decrypt | #6 |

All are `SecureString` under the default `aws/ssm` key. The plan role is denied `kms:Decrypt`, so it can list them but never read them.

The hetu HMAC key is never rotated (TD-1) and never leaves SSM except for one offline backup taken at creation. Generate it straight onto the offline medium so the value never sits in a shell history or a cloud drive, then load it:

```sh
openssl rand -hex 32 > /Volumes/<offline-medium>/kuutti-prod-hetu-hmac-key.txt
aws ssm put-parameter --name /kuutti/prod/hetu-hmac-key --type SecureString \
  --value "$(cat /Volumes/<offline-medium>/kuutti-prod-hetu-hmac-key.txt)"
```

`<offline-medium>` is an encrypted volume whose passphrase the association holds separately. Eject it afterwards; the association keeps it, not the maintainer's desk drawer.

`db-app-password` is created by `scripts/db-app-role.sh`; rotating it is `ALTER ROLE kuutti_app PASSWORD '…'` through the same tunnel, `put-parameter --overwrite`, and a restart of the API. The two signing keys are not random bytes: the CloudFront key is an RSA key pair whose public half becomes a CloudFront public-key resource (M3), and the Telia key is whatever the broker contract specifies (M2); their creation steps land with those milestones. The RDS master password is not managed here at all: `manage_master_user_password = true` leaves it with AWS so it never enters state.

## What is not here

Dokploy's own configuration (no provider exists; `user_data` installs it, its contents are backed up from `/etc/dokploy`), DNS for the API host names, secret values, EAS and Expo configuration, store setup, the Telia contract, and creation of the AWS account.
