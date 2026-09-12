# Infrastructure

OpenTofu, AWS, one account, eu-central-1. See `docs/adr/001-infrastructure-as-code.md` for why, and `.claude/rules/infra.md` for the standing rules.

Commands below use `tofu`. Terraform is command-compatible if you have it instead, but the committed lockfile is OpenTofu's.

## Layout

| path | contents | when |
|---|---|---|
| `bootstrap/` | state bucket, GitHub OIDC provider, CI roles | once, before anything else |
| `modules/` | reusable resource groups | as milestones need them |
| `envs/staging`, `envs/prod` | one composition per environment | M1 |
| `github/` | repository settings, branch protection, environments | when repo settings next change |

Modules arrive with the milestone that needs them: network, compute, data and IAM in M1; media and delivery in M3; email in M5.

## Bootstrap, run once

Prerequisites: the AWS account exists, root has MFA, the account is converted to a paid plan (the credits-based free tier closes unconverted accounts after six months), and you have admin credentials in your shell.

GitHub's immutable subject claims mean the trust policy keys on numeric IDs, not names. Get them:

```sh
gh api repos/kuutti-fi/kuutti-app --jq '{repo_id: .id, owner_id: .owner.id}'
```

Then:

```sh
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars   # fill in the two IDs
tofu init
tofu apply
```

This runs with local state, because the bucket it creates is where state will live. Migrate immediately afterwards:

```sh
# uncomment the backend block in versions.tf, then
tofu init -migrate-state
rm -f terraform.tfstate terraform.tfstate.backup
```

`terraform.tfvars` and any `*.tfstate` are gitignored. The state bucket holds secrets: it is versioned, encrypted, public access is blocked, and only the CI roles and the maintainer can read it.

## Environments

```sh
cd infra/envs/staging   # or prod
tofu init
tofu plan
```

Applies run through CI. Plans run on every pull request and are posted to it. Staging applies on merge to `main`. Production applies only after approval on the `prod` GitHub environment.

Every IAM role declared in an environment or module sets `permissions_boundary` to the bootstrap output `permissions_boundary_arn`; the apply role refuses to create a role without it. The plan role cannot read secrets, logs, or object data, only resource metadata and state.

## Secrets

Secret parameters are not resources in this code: the AWS provider would store the decrypted value in state on every refresh, and `ignore_changes` only hides the diff. Create them once, out of band, and reference them by path in the instance-role policy:

```sh
aws ssm put-parameter --name /kuutti/prod/hetu-hmac-key --type SecureString \
  --value "$(openssl rand -hex 32)" --overwrite
```

The hetu HMAC key is never rotated (TD-1). Take one offline backup of it at creation. The RDS master password is not managed here at all: `manage_master_user_password = true` leaves it with AWS so it never enters state.

## What is not here

Dokploy's own configuration (no provider exists; `user_data` installs it, its contents are backed up from `/etc/dokploy`), secret values, EAS and Expo configuration, store setup, the Telia contract, and creation of the AWS account.
