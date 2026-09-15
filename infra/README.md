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
pnpm aws:login
```

`aws:login` (`scripts/aws-login`) writes the Identity Center profile on first use and signs in whenever the session has expired; the runbook's section 6 describes what it configures.

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

### Ruleset switch (#8, last)

Once the checks exist on `main`, the ruleset `23053522` gains a pull-request rule and required checks, and direct pushes end. Code-owner review stays off: the only code owner is the maintainer, and an author cannot approve their own pull request, so requiring it would block every merge.

```sh
gh api -X PUT repos/kuutti-fi/kuutti-app/rulesets/23053522 --input - <<'JSON'
{"name":"Protect main","target":"branch","enforcement":"active","bypass_actors":[],
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "rules":[
  {"type":"deletion"},{"type":"non_fast_forward"},{"type":"required_linear_history"},
  {"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":false,"require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":true,"allowed_merge_methods":["squash","rebase"]}},
  {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"required_status_checks":[
   {"context":"DCO sign-off"},{"context":"TruffleHog"},{"context":"typecheck"},{"context":"lint"},{"context":"test-api-packages"},{"context":"test-mobile"},{"context":"scenarios"},{"context":"schema-drift"},{"context":"workflows"}]}}
 ]}
JSON
```

`i18n` joins the list when #13 lands. Then update `CLAUDE.md` (Git) and `CONTRIBUTING.md` through the first pull request.

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

### CI

| workflow | trigger | role | does |
|---|---|---|---|
| `infra.yml` | pull requests and `main` touching `infra/**` | `kuutti-ci-plan` | `fmt` for everything, `validate` and `plan` for `envs/staging` and `envs/prod`; each plan is a sticky comment on the pull request; on `main` it then applies `envs/staging` behind the `staging` environment with `kuutti-ci-apply` |
| `infra-prod.yml` | `v*` tags | `kuutti-ci-apply` | applies `envs/prod` after the `prod` reviewer approves |
| `infra-oidc.yml` | changes under `infra/**` | `kuutti-ci-plan` | proves the plan role still cannot decrypt a SecureString |
| `eas-build.yml` | `main` (fingerprint changed), `v*` tags, by hand | none (GitHub environment `staging` or `prod`) | native builds on EAS: `development` and `preview` when the fingerprint of `main` differs from the last development build's, `production` on a tag; links on the pinned builds issue (`apps/mobile/README.md`) |
| `build.yml` | every push and pull request | none | builds the API image on arm64 and smoke-tests it; on `main` pushes `ghcr.io/kuutti-fi/kuutti-api:<sha>` and `:main`, on a pull request from this repository `:pr-<n>-<sha7>` for its preview, on a tag retags that same image as `:vX.Y.Z`, then calls `deploy.yml` (Dokploy, `/health`, then the signed EAS Update to the environment's channel, #10) and, for tags, `release.yml` |
| `preview.yml` | pull requests from this repository | none (GitHub environment `preview`) | the three previews of #9: the pull request's image as Dokploy application `api-pr-<n>` on the staging box with database `kuutti_pr_<n>`, the web export on EAS Hosting as alias `pr-<n>`, an EAS Update on branch `pr-<n>` when native code changed; one sticky comment |
| `preview-cleanup.yml` | pull request closed, nightly, by hand from `main` | `kuutti-ci-plan` | removes the Dokploy application, the EAS alias and branch, and drops `kuutti_pr_<n>` through the `kuutti-staging-preview-database` Run Command document; the nightly run also retires previews older than 7 days |

OpenTofu and the OIDC exchange are installed by `.github/scripts/install-tofu.sh` and `aws-oidc.sh`; no third-party action touches credentials. The bootstrap is neither planned nor applied by CI: its inputs are in the maintainer's tfvars, and its plan is the maintainer's drift check.

The staging apply and the staging deploy run only while the repository variable `STAGING_ENABLED` is `true` (`gh variable set STAGING_ENABLED --body true`). Until the maintainer sets it, every merge plans and builds but applies and deploys nothing: staging starts when there is something to deploy, prod at the first release tag.

Until the media module puts CloudFront in front (M3), TLS terminates at Traefik on the box and the API answers on the Elastic IP directly (#7).

Each environment composes the three modules (#7, TD-19):

| module | creates | notes |
|---|---|---|
| `network` | VPC /16, one public subnet, two private subnets, DB subnet group, `api` and `db` security groups | no NAT; `db` admits 5432 from the `api` group only; port 22 only for `ssh_cidrs`, empty by default |
| `data` | RDS PostgreSQL 17 single-AZ, gp3 20→100 GB, 35-day PITR, `rds.force_ssl=1`, Extended Support declined, master password held by AWS | staging `db.t4g.micro`, prod `db.t4g.small` with deletion protection and a final snapshot |
| `compute` | t4g.small Ubuntu 24.04 arm64, Elastic IP, IMDSv2, instance role `kuutti-api-<env>` under the boundary, log group `/kuutti/<env>/api`, first-boot script installing Dokploy | staging also owns the account-wide Session Manager preferences, `/kuutti/ssm-sessions`, and the `kuutti-staging-preview-database` Run Command document (#9) |

The composition then writes the non-secret parameters `app-env`, `log-level`, `db-host`, `db-port`, `db-name`, `db-user` under `/kuutti/<env>/`; the API turns them into `APP_ENV`, `DB_HOST` and so on at boot and composes `DATABASE_URL` with `sslmode=require`.

Every IAM role declared in an environment or module sets `permissions_boundary` to the bootstrap output `permissions_boundary_arn`; the apply role refuses to create a role without it. The plan role cannot read secrets, logs, or object data, only resource metadata and state.

### Cost

TD-4 budgets 50 EUR a month. One environment is roughly 30 EUR (instance, database, address, storage); both together are around 65 EUR, above the budget alert. Decision (2026-09-14): staging is applied now, prod when there is a first release; raising `monthly_budget_usd` in the bootstrap is the deliberate step that goes with it.

### After the first apply, once per environment

1. **Application role.** RDS is private, so the script tunnels through the box with Session Manager (`brew install --cask session-manager-plugin` once). It creates `kuutti_app`, makes it the owner of the `kuutti` database so migrations can run, and stores its password as `/kuutti/<env>/db-app-password`. On staging it also creates `kuutti_preview` for the pull-request databases (#9): `CREATEDB`, owner of every `kuutti_pr_<n>`, and no `CONNECT` on `kuutti` (revoked from `PUBLIC`; the owner and the master keep theirs), password as `/kuutti/staging/db-preview-password`. The master password stays inside the script's process.

   ```sh
   infra/scripts/db-app-role.sh staging
   ```

2. **Dokploy.** The first boot installs Docker and Dokploy `v0.30.6` (variable `dokploy_version`) with the installer vendored at `modules/compute/installer/`, verified by hash on the box. Port 3000 is never opened; reach the UI through a port forward, create the admin account, and keep its credentials in the password manager:

   ```sh
   aws ssm start-session --target "$(tofu output -raw instance_id)" --document-name AWS-StartPortForwardingSession --parameters portNumber=3000,localPortNumber=3000
   ```

   Then at `http://localhost:3000`: one project named after the environment, one application `api` deployed from the GHCR image (#8), domain `api.staging.<domain>` or `api.<domain>` with Let's Encrypt through Traefik, container port 3000. Application environment is exactly `NODE_ENV=production`, `APP_ENV=staging` (or `production`), `PORT=3000`; everything else comes from SSM through the instance role, never from Dokploy. DNS is not in this repository: an A record per API host name to `tofu output -raw public_ip`.

3. **Deploy path.** `deploy.yml` calls Dokploy's API from GitHub, so the control plane must be reachable over HTTPS: in Dokploy, Web Server, set its own domain (`dokploy.staging.<domain>` or `dokploy.<domain>`) with Let's Encrypt; port 3000 stays closed, Traefik serves the UI and API on 443. Turn on two-factor authentication for the admin. In Settings, Profile, generate an API key for CI. Then, for each GitHub environment, three variables and one secret (`gh secret set` prompts for the value; never paste it into a command line):

   ```sh
   gh variable set DOKPLOY_URL --env staging --body https://dokploy.staging.<domain>
   gh variable set DOKPLOY_APPLICATION_ID --env staging --body <id from the application's URL in Dokploy>
   gh variable set API_URL --env staging --body https://api.staging.<domain>
   gh secret set DOKPLOY_TOKEN --env staging
   ```

   After the first image push, make the GHCR package public once (package settings, Danger zone, Change visibility) so the box pulls without a credential.

4. **Checks.** From the box (`aws ssm start-session --target <instance-id>`, shell `ssm-user`, `sudo -i` for root). Everything typed and printed in a session is streamed to `/kuutti/ssm-sessions`, so a secret must never be printed there; the forms below keep the value inside the shell:

   ```sh
   aws ssm get-parameter --name /kuutti/<other env>/db-host                     # must be refused
   PGPASSWORD="$(aws ssm get-parameter --name /kuutti/<env>/db-app-password --with-decryption --query Parameter.Value --output text)" \
     psql "host=$(aws ssm get-parameter --name /kuutti/<env>/db-host --query Parameter.Value --output text) dbname=kuutti user=kuutti_app sslmode=require" -c 'select 1'
   ```

   From your machine: `aws iam get-role --role-name kuutti-api-<env> --query Role.PermissionsBoundary` shows the boundary.

### Previews (#9)

Every pull request from this repository gets three previews, deployed by `preview.yml` and removed by `preview-cleanup.yml` (TD-2, TD-19):

| lane | what | where |
|---|---|---|
| API | the image `build.yml` pushed as `:pr-<n>-<sha7>`, run as Dokploy application `api-pr-<n>` in the `previews` project on the staging box; at boot the API creates `kuutti_pr_<n>` on the staging RDS instance, migrates and seeds it (never a copy of anything) | `https://pr-<n>.<PREVIEW_API_DOMAIN>` |
| Web | `expo export --platform web` of the same commit with `EXPO_PUBLIC_API_URL` pointed at that API, on EAS Hosting | `https://<EAS_HOSTING_SUBDOMAIN>--pr-<n>.expo.app` |
| Native | an EAS Update on branch `pr-<n>` when native code, auth, push, camera or the `@expo/fingerprint` hash changed against `main`; the QR code opens it in the dev client (#10). Dormant until `expo-updates` is configured | the comment's QR code |

Dokploy's own GitHub-App preview deployments are not used. They exist only for applications built from a Git source, so they would build every pull request on the t4g.small (the rules say images are built in CI, not on the box), and the container receives nothing but `DOKPLOY_DEPLOY_URL`: no pull request number for `kuutti_pr_<n>`, no per-pull-request CORS origin. `preview.yml` instead creates a docker-source application per pull request through the same Dokploy API `deploy.yml` uses, with a member token that reaches only the `previews` project, and every address is a function of the pull request number, so the API allows exactly its own web origin.

What a preview is: `APP_ENV=preview` and `PR_NUMBER=<n>` from Dokploy, everything else from `/kuutti/staging/*` through the instance role (the same role, unchanged; `/kuutti/prod/*` stays out of reach, as the cross-environment check under Checks proves). It connects as `kuutti_preview`, which owns the `kuutti_pr_*` databases and cannot open `kuutti`. Rate limit 30 requests a minute, `X-Robots-Tag: noindex`, pool of 3 connections. At most three previews at a time: a fourth pull request gets a comment and no deployment. The nightly sweep retires previews older than 7 days and those of pull requests that closed without a cleanup run. Forks and Dependabot get no secrets, so no preview.

**Trust.** A preview runs a pull request's code on the staging box before anyone has reviewed it, with the staging instance role: it can read every `/kuutti/staging/*` parameter (from M2 that includes the staging hetu HMAC key and the Telia test-bed key), and its Dokploy token can attach any host name, the staging API's included, to a preview container. Opening a pull request from this repository therefore means staging-level trust, which today is the maintainer alone. Two things bound it: the separate database role above keeps preview code out of staging data by construction, and the `preview` environment can require the maintainer's approval before each deployment, which turns "every push" into "every push the maintainer clicked". Switch that on before adding collaborators who are not staging operators:

```sh
gh api -X PUT "$R/environments/preview" --input - <<'JSON'
{"wait_timer":0,"reviewers":[{"type":"User","id":9991098}],"prevent_self_review":false,"deployment_branch_policy":null}
JSON
```

Related, for the milestones that touch it: the Dokploy member never gets the volume or mount permissions (a bind mount of the Docker socket is root on the box); updates are code-signed (ADR-004) and the signing key `EXPO_UPDATES_PRIVATE_KEY` goes into `preview` only by your decision, since a pull request's edited workflow could then sign an update for any branch (until then the native lane publishes nothing and the comment says so; `EXPO_TOKEN` alone cannot forge a signed update); and at M2 previews must keep running against the mock IdP (rules/mobile.md), so `parseConfig` will refuse `APP_ENV=preview` with a real Telia issuer. The release path's own gap, that a pull request holding `packages: write` can push any tag of the API image and a later release tag would retag it, predates previews and is tracked separately (build provenance attestation, #8 follow-up).

Once, after staging is applied and its Dokploy is configured:

1. **Preview role.** `kuutti_preview` from step 1 above; on a staging instance whose role script ran before #9, re-run only that part by hand through the same tunnel.
2. **DNS.** A wildcard record `*.preview.api.staging.<domain>` to `tofu output -raw public_ip`. Traefik issues one Let's Encrypt certificate per preview host.
3. **Dokploy.** A project `previews`; its default environment holds the applications, and its id (from the environment's URL in Dokploy) is `DOKPLOY_ENVIRONMENT_ID`. A member user `ci-preview` (Settings, Users) with access to the `previews` project and that environment only, permissions to create and delete services and to create domains, nothing else (no volumes, no Traefik files, no Docker access); sign in as that member and generate its API key. The staging `api` application stays out of the member's reach. Check as the member that `application.one` on the staging application's id is refused before enabling previews.
4. **EAS.** Once in `apps/mobile`: `eas init` writes `extra.eas.projectId` into `app.json`, commit it. The first hosting deploy picks the subdomain that every preview alias hangs off: `npx expo export --platform web && eas deploy --dev-domain kuutti`; that name is `EAS_HOSTING_SUBDOMAIN`. On expo.dev, a robot user with the Hosting and Update permissions provides `EXPO_TOKEN`. The native lane starts publishing when #10 adds `expo-updates` (`updates.url` in `app.json`); nothing here changes then.
5. **Bootstrap.** `tofu apply` in `infra/bootstrap` for the plan role's `preview-cleanup` policy (it may send exactly the document below to exactly the staging box). The next staging apply lands the document `kuutti-staging-preview-database`.
6. **GitHub.** The environment `preview` with no deployment branch restriction (pull requests deploy from any branch of this repository), four variables and two secrets, then the switch:

   ```sh
   R=repos/kuutti-fi/kuutti-app
   gh api -X PUT "$R/environments/preview" --input - <<'JSON'
   {"wait_timer":0,"reviewers":[],"deployment_branch_policy":null}
   JSON
   gh variable set DOKPLOY_URL --env preview --body https://dokploy.staging.<domain>
   gh variable set DOKPLOY_ENVIRONMENT_ID --env preview --body <id>
   gh variable set PREVIEW_API_DOMAIN --env preview --body preview.api.staging.<domain>
   gh variable set EAS_HOSTING_SUBDOMAIN --env preview --body kuutti
   gh secret set DOKPLOY_TOKEN --env preview     # the ci-preview member's key
   gh secret set EXPO_TOKEN --env preview        # the robot user's token
   gh variable set PREVIEWS_ENABLED --body true
   ```

Done when (the issue's list): a pull request that changes a screen gets its comment within 10 minutes and the page shows the version and commit of its own API; `/health` of the preview reports the pull request's commit; `psql -l` through the tunnel lists `kuutti_pr_<n>` while the pull request is open and not after it closes; a row written through one preview is absent from another; the fourth concurrent pull request gets the limit comment; the workflow's CORS step refuses the staging web origin and another pull request's; the preview reads only `/kuutti/staging/*`.

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
| `/kuutti/staging/db-preview-password` | a preview API as `kuutti_preview` (creates, owns and serves `kuutti_pr_<n>`); the `preview-database` Run Command document that drops it | #9 |
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

Dokploy's own configuration (no provider exists; `user_data` installs it, its contents are backed up from `/etc/dokploy`), DNS for the API host names (the preview wildcard included), secret values, the EAS account side (the organisation and project, credentials, the robot token, the update signing key; `apps/mobile/README.md`), store setup, the Telia contract, and creation of the AWS account.
