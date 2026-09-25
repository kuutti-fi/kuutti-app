# Infrastructure

OpenTofu, AWS, one account, eu-central-1. See `docs/adr/001-infrastructure-as-code.md` for why, and `.claude/rules/infra.md` for the standing rules.

Commands below use `tofu`. Terraform is command-compatible if you have it instead, but the committed lockfile is OpenTofu's.

## Layout

| path | contents | when |
|---|---|---|
| `bootstrap/` | state bucket, GitHub OIDC provider, CI roles, budget and billing alarm, the hosted zone of the project domain | once, before anything else |
| `modules/` | `network`, `compute`, `data` (#7); `media` (#48, dormant until the cutover below); email later | as milestones need them |
| `envs/staging`, `envs/prod` | one composition per environment: the three modules plus the non-secret parameters | M1 (#7) |
| `github/` | repository settings, branch protection, environments | not adopted; `gh api` below until the GitHub provider question is settled |

Modules arrive with the milestone that needs them: network, compute and data in M1 (#7); media and delivery in M3 (#48, ADR-005); email in M5. `scripts/` holds the one-time procedures that are deliberately not resources.

## Account, once (console, maintainer only)

Everything in this section is click-ops by design: it is the part ADR-001 allows, and it happens before any code can run. Do it in this order; the click-by-click version, including the stopgap mailbox while the project domain has no mail, is `docs/runbooks/aws-account-setup.md`.

1. **Create the account.** Root email is a re-pointable alias on the project domain, never a personal address (TD-4); until the domain has mail, a dedicated mailbox created for the project, re-pointed later from account settings. Account name `kuutti`. Set the billing, operations and security alternate contacts to project addresses too.
2. **Secure root.** Hardware MFA on root, no root access keys. `aws iam get-account-summary` must later show `AccountMFAEnabled: 1` and `AccountAccessKeysPresent: 0`.
3. **Paid account plan**, chosen at sign-up. Free-plan accounts close after six months or when the credits run out (TD-19), and enabling Identity Center (step 5) creates an organisation, which force-upgrades a free-plan account anyway and expires the sign-up credits on either plan. Billing must show no free-plan banner.
4. **Enable billing metrics.** Billing and Cost Management → Billing preferences → Alert preferences → *Receive CloudWatch Billing Alerts*. One-way switch; the metric appears about 15 minutes later. The bootstrap's billing alarm reads it.
5. **Admin access for the bootstrap apply.** **IAM Identity Center** (ADR-001, admin access): one user for the maintainer, one permission set (`AdministratorAccess`), MFA required by the identity store, sessions issued by `aws configure sso`. No IAM user and no long-lived access key ever exist. Enabling Identity Center creates an organisation with this account as its management account; see step 6 for what that means at transfer time. A single IAM user with MFA and console-issued session credentials is the fallback only if Identity Center cannot be enabled.
6. **The domain.** `kuutti.app`, registered 2026-09-17 through Route 53 in this account (Registered domains, Register domains) with the project mailbox as registrant contact; auto-renew, transfer lock and privacy protection on. ICANN requires the registrant address to be verified within 15 days of registration or the domain is suspended: `aws route53domains get-contact-reachability-status --region us-east-1 --domain-name kuutti.app` must say `DONE`; while it says `PENDING`, click the link in the mail to the project mailbox (`resend-contact-reachability-email` if it has lapsed). A purchase with contact details cannot be code. The hosted zone Route 53 creates at registration is adopted by the bootstrap (`bootstrap/dns.tf`, an import block), and every record is declared by the environment that owns its target (`envs/<env>/dns.tf`). The domain moves with the account; it is one variable (`domain`) per root if it ever changes, which stays cheap until M2 binds universal links to it.
7. **Later, nothing to do now:** the account moves under an organisation owned by the association (TD-4). Because Identity Center made this account the management account of its own organisation, that move means deleting this one-account organisation and its Identity Center instance first, then accepting the association's invitation and re-creating admin access there (ADR-001). Root email and alternate contacts re-point; nothing under `infra/` changes.

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

`i18n` (#13), `licenses` and `dependency review` (#16) join the list: add `{"context":"i18n"},{"context":"licenses"},{"context":"dependency review"}`. Then update `CLAUDE.md` (Git) and `CONTRIBUTING.md` through the first pull request.

### Hardening settings (#16), maintainer only

Settings of the repository and the organisation exist only on GitHub, so the commands live here; `export.yml` copies the results out weekly. An agent never runs these (CLAUDE.md, Git).

**Tag ruleset.** A `v*` tag deploys production, so creating, moving and deleting one is for repository admins only:

```sh
gh api -X POST repos/kuutti-fi/kuutti-app/rulesets --input - <<'JSON'
{"name":"Protect release tags","target":"tag","enforcement":"active",
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],
 "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
 "rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}]}
JSON
```

`actor_id` 5 is the built-in repository admin role. Check: a member with write access and no bypass is refused when pushing `v0.0.0-test`, with the rule named in the error.

**Code scanning, secret scanning, Actions allow-list:**

```sh
R=repos/kuutti-fi/kuutti-app
gh api -X PATCH "$R/code-scanning/default-setup" -f state=configured -f 'languages[]=actions' -f 'languages[]=javascript-typescript'
gh api -X PATCH "$R" --input - <<'JSON'
{"security_and_analysis":{"secret_scanning_non_provider_patterns":{"status":"enabled"},"secret_scanning_validity_checks":{"status":"enabled"}}}
JSON
gh api -X PUT "$R/actions/permissions/selected-actions" --input - <<'JSON'
{"github_owned_allowed":true,"verified_allowed":false,"patterns_allowed":[
 "docker/build-push-action@*","docker/setup-buildx-action@*","docker/metadata-action@*","docker/login-action@*",
 "trufflesecurity/trufflehog@*","ossf/scorecard-action@*"]}
JSON
```

"Any verified creator" is a far larger set than the six we run. `actions/*` and `github/*` (checkout, cache, setup-python, dependency-review, attest-build-provenance, codeql-action) stay allowed as GitHub-owned. After the change every workflow must still run green on `main`; a workflow that names an action outside the list fails at start-up with the action named.

**Organisation** (an owner; `gh auth refresh -s admin:org` to read these through the API). Verify `kuutti.app`: Settings, Verified and approved domains, Add a domain; put the record name and code into `infra/bootstrap/terraform.tfvars` (`github_domain_verification`), `tofu apply` in `infra/bootstrap`, then press Verify. New-repository security defaults (Dependabot alerts, secret scanning, push protection) on. Third-party application access restricted, applications approved by an owner. Fine-grained personal access tokens require approval; classic tokens have no access to the organisation. Organisation Actions policy equal to the repository's. Review the six members: role in the organisation, role on this repository, nobody holding more than the work needs; write the result into #16.

**Build provenance.** `build.yml` signs a provenance attestation for every image it pushes from `main`, and again under the tag when a release retags that digest (job `attest`). Before deploying an image by hand, in a recovery, check that it is one of ours, built by that workflow from that ref:

```sh
gh attestation verify oci://ghcr.io/kuutti-fi/kuutti-api:<sha> --repo kuutti-fi/kuutti-app \
  --signer-workflow kuutti-fi/kuutti-app/.github/workflows/build.yml --source-ref refs/heads/main
# a release: oci://...:vX.Y.Z with --source-ref refs/tags/vX.Y.Z
```

`--repo` alone is not enough: a pull request from this repository runs its own copy of `build.yml` and could push and attest an image under any tag. Its certificate carries `refs/pull/<n>/merge`, so `--source-ref` refuses it, and `--signer-workflow` refuses any other workflow file. Images built before #16 landed have no attestation.

### Restoring from an export

`export.yml` writes `s3://<state bucket>/github-export/<date>/` every Sunday: `issues.json`, `issue-comments.json`, `milestones.json`, `labels.json`, `rulesets.json`, `environments.json`, `environment-branch-policies.json`, `manifest.json` and `repository.bundle`. Its role (`kuutti-ci-export`) trusts the `main` branch only, can add objects under that prefix and nothing else, and cannot delete; the bucket is versioned and replaced versions are kept a year. After applying the bootstrap, once: `gh variable set AWS_EXPORT_ROLE_ARN --body "$(cd infra/bootstrap && tofu output -raw ci_export_role_arn)"`; the workflow stays dormant until then. To restore into a new or scratch repository (`NEW=owner/name`, signed in with `pnpm aws:login`):

```sh
B=$(cd infra/bootstrap && tofu output -raw state_bucket)
# One version per object is the rule: a second version under a date means something overwrote the export.
aws s3api list-object-versions --bucket "$B" --prefix "github-export/<date>/" --query 'Versions[].[Key,VersionId,IsLatest,LastModified]' --output table
aws s3 cp "s3://$B/github-export/<date>/" export/ --recursive
git clone export/repository.bundle restored && git -C restored remote set-url origin "https://github.com/$NEW.git" && git -C restored push --all origin && git -C restored push --tags origin
jq -c '.[] | {name, color, description}' export/labels.json | while read -r l; do gh api -X POST "repos/$NEW/labels" --input - <<< "$l" || true; done
jq -c '.[] | {title, state, description, due_on}' export/milestones.json | while read -r m; do gh api -X POST "repos/$NEW/milestones" --input - <<< "$m"; done
# Issues in number order, so that #n stays #n while nothing else has been created. Pull requests are in
# the list too (they have a pull_request key): create a placeholder issue for each to keep the numbering.
jq -c 'sort_by(.number) | .[] | {title, body: ((.body // "") + "\n\n_Restored from the export; originally #\(.number) by @\(.user.login), \(.created_at)._"), labels: [.labels[].name]}' export/issues.json \
  | while read -r i; do gh api -X POST "repos/$NEW/issues" --input - <<< "$i" --jq .number; sleep 1; done
jq -c '.[] | del(.id, .source, .source_type, .node_id, ._links, .created_at, .updated_at, .current_user_can_bypass)' export/rulesets.json | while read -r r; do gh api -X POST "repos/$NEW/rulesets" --input - <<< "$r"; done
```

Comments (`issue-comments.json`, each with its `issue_url`) are posted the same way through `repos/$NEW/issues/<n>/comments`; closed issues are closed afterwards with `gh issue close`. Environment protection rules are re-created with the `PUT .../environments/<name>` commands of this file; `environments.json` is the record of what they were. Secrets are not in the export and never can be: they are re-entered from the password manager (`docs/runbooks/custody.md`).

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
| `build.yml` | every push and pull request | none | builds the API image on arm64 and smoke-tests it; on `main` pushes `ghcr.io/kuutti-fi/kuutti-api:<sha>` and `:main`, on a pull request from this repository `:pr-<n>-<sha7>` for its preview, on a tag retags that same image as `:vX.Y.Z`, then calls `deploy.yml` (Dokploy, `/health`, then the EAS Update to the environment's channel, #10) and, for tags, `release.yml` |
| `preview.yml` | pull requests from this repository | none (GitHub environment `preview`) | the three previews of #9: the pull request's image as Dokploy application `api-pr-<n>` on the staging box with database `kuutti_pr_<n>`, the web export on EAS Hosting as alias `pr-<n>`, an EAS Update on branch `pr-<n>` when native code changed; one sticky comment |
| `preview-cleanup.yml` | pull request closed, nightly, by hand from `main` | `kuutti-ci-plan` | removes the Dokploy application, the EAS alias and branch, and drops `kuutti_pr_<n>` through the `kuutti-staging-preview-database` Run Command document; the nightly run also retires previews older than 7 days |

OpenTofu and the OIDC exchange are installed by `.github/scripts/install-tofu.sh` and `aws-oidc.sh`; no third-party action touches credentials. The bootstrap is neither planned nor applied by CI: its inputs are in the maintainer's tfvars, and its plan is the maintainer's drift check.

The staging apply and the staging deploy run only while the repository variable `STAGING_ENABLED` is `true` (`gh variable set STAGING_ENABLED --body true`). Until the maintainer sets it, every merge plans and builds but applies and deploys nothing: staging starts when there is something to deploy, prod at the first release tag.

Until an environment's `media_enabled` is set (Media, below), TLS terminates at Traefik on the box and the API answers on the Elastic IP directly (#7).

Each environment composes the three modules (#7, TD-19):

| module | creates | notes |
|---|---|---|
| `network` | VPC /16, one public subnet, two private subnets, DB subnet group, `api` and `db` security groups | no NAT; `db` admits 5432 from the `api` group only; port 22 only for `ssh_cidrs`, empty by default |
| `data` | RDS PostgreSQL 17 single-AZ, gp3 20→100 GB, 35-day PITR, `rds.force_ssl=1`, Extended Support declined, master password held by AWS | staging `db.t4g.micro`, prod `db.t4g.small` with deletion protection and a final snapshot |
| `compute` | t4g.small Ubuntu 24.04 arm64, Elastic IP, IMDSv2, instance role `kuutti-api-<env>` under the boundary, log group `/kuutti/<env>/api`, first-boot script installing Dokploy | staging also owns the account-wide Session Manager preferences, `/kuutti/ssm-sessions`, and the `kuutti-staging-preview-database` Run Command document (#9) |

The composition then writes the non-secret parameters `app-env`, `log-level`, `db-host`, `db-port`, `db-name`, `db-user` under `/kuutti/<env>/`; the API turns them into `APP_ENV`, `DB_HOST` and so on at boot and composes `DATABASE_URL` with `sslmode=require`.

Every IAM role declared in an environment or module sets `permissions_boundary` to the bootstrap output `permissions_boundary_arn`; the apply role refuses to create a role without it. The plan role cannot read secrets, logs, or object data, only resource metadata and state.

### Media (#48, ADR-005)

`infra/modules/media`, composed by each environment behind `media_enabled` (default `false`): the private media bucket `kuutti-media-<env>-<account>` (SSE-S3, versioning off so an erased photo is gone, a policy that lets only the distribution read `media/*`), the instance role's right to write and remove objects under `media/`, the CloudFront distribution on `api.<env>.<domain>` with the API as its default origin and the bucket behind `/media/*`, the key group for signed URLs, the ACM certificate in us-east-1, and the alias records. The API signs URLs for fifteen minutes with the private key from SSM; `apps/api/src/media/` is the code. The module writes `s3-bucket`, `media-url-base` and `cloudfront-key-pair-id` under `/kuutti/<env>/` for the API.

Cutover, once per environment, maintainer only. The key pair first, offline like the other keys:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /Volumes/<offline-medium>/kuutti-<env>-cloudfront-signing.pem
openssl pkey -in /Volumes/<offline-medium>/kuutti-<env>-cloudfront-signing.pem -pubout -out infra/envs/<env>/cloudfront-signing-key.pub.pem
aws ssm put-parameter --name /kuutti/<env>/cloudfront-signing-key --type SecureString --value "$(cat /Volumes/<offline-medium>/kuutti-<env>-cloudfront-signing.pem)"
```

Then give the `api` application in Dokploy a second domain, `origin.api.<env>.<domain>` with Let's Encrypt (Domains tab, same as `api.<env>` in `dokploy-setup.sh`): CloudFront connects to the box by that name and Traefik must present a certificate for it, while the `api.<env>` router keeps serving the forwarded Host. Commit the public key and `media_enabled = true` in `envs/<env>/terraform.tfvars.example`'s real counterpart (CI passes it through the environment's tfvars; for staging, set it in `envs/staging/main.tf`'s variable default if the tfvars is not in CI), push, and let the apply run: it creates the bucket, the certificate (validated by a record in the zone, a few minutes), the distribution (about ten minutes), moves `api.<env>` from the Elastic IP to the alias, points `origin.api.<env>` at the box, and writes the three parameters. The next deploy of the API logs `"mode":"cloudfront"` under `media`. Checks: `/health` through `api.<env>` answers; an upload from the phone appears as three objects under `media/<key>/` in the bucket and nothing else; the URL the app receives opens once and answers 403 without its query string or after fifteen minutes; `photo_access` has a row per URL.

After the cutover the box still admits 443 from anywhere, because Dokploy's control plane (`deploy.yml`) and the pull-request previews are served on it directly. `cloudfront_only_ingress` (network module) is the switch that closes it to CloudFront's prefix list once those two are behind the distribution as well; ADR-005 names that follow-up.

### Observability (#11)

`infra/modules/observability`, composed by each environment: an SNS topic `kuutti-<env>-alerts` in eu-central-1, alarms for the instance status check, the instance and RDS CPU credit balances, RDS free storage and the API's 5xx rate (a metric filter on `/kuutti/<env>/api`), and three saved Logs Insights queries. The subscriber is the repository variable `ALERT_EMAIL` (`gh variable set ALERT_EMAIL --body <project alias>`), which CI hands to OpenTofu as `TF_VAR_alert_email`; confirm the subscription from that mailbox after the first apply (`aws sns list-subscriptions-by-topic --topic-arn <alerts_topic_arn>` shows `PendingConfirmation` until the link in AWS's mail is followed), then run the delivery test in `docs/runbooks/alerts.md`. Without the variable the topic exists with no subscriber. About 0.80 USD a month per environment.

Logs reach that group through the Docker daemon's default driver, which user data sets to `awslogs` before Dokploy's installer starts a single container (`modules/compute/templates/user_data.sh.tpl`): every container on the box logs to `/kuutti/<env>/api`, one stream per container name, Dokploy's own included. Nothing to set per application. The instance role allows the stream calls; the group has 30-day retention.

Sentry (TD-19, the one vendor besides AWS, Expo, GitHub and Telia), maintainer once; the click-by-click version with the two ways to prove it is `docs/runbooks/sentry-setup.md`: an organisation `kuutti` in the EU data region (`https://de.sentry.io`), projects `api` and `mobile`. The DSNs are public by design: `aws ssm put-parameter --name /kuutti/<env>/sentry-dsn --type String --value <api dsn>` per environment (the API reads it as `SENTRY_DSN`; unset keeps the SDK off), and `eas env:create --environment preview --name EXPO_PUBLIC_SENTRY_DSN --value <mobile dsn> --visibility plaintext` (and `production`). The source-map auth token is a secret in exactly three places, never at repository level: `gh secret set SENTRY_AUTH_TOKEN --env staging` and `--env prod` for the updates `deploy.yml` publishes, and `eas env:create --environment preview --name SENTRY_AUTH_TOKEN --visibility secret` (and `production`) for native builds. The token's scope is `project:releases` and `org:read`, nothing more.

### Cost

TD-4 budgets 50 EUR a month. One environment is roughly 30 EUR (instance, database, address, storage); both together are around 65 EUR, above the budget alert. Decision (2026-09-14): staging is applied now, prod when there is a first release; raising `monthly_budget_usd` in the bootstrap is the deliberate step that goes with it.

### After the first apply, once per environment

1. **Application role.** RDS is private, so the script tunnels through the box with Session Manager (`brew install --cask session-manager-plugin` once). It creates `kuutti_app`, makes it the owner of the `kuutti` database so migrations can run, and stores its password as `/kuutti/<env>/db-app-password`. On staging it also creates `kuutti_preview` for the pull-request databases (#9): `CREATEDB`, owner of every `kuutti_pr_<n>`, and no `CONNECT` on `kuutti` (revoked from `PUBLIC`; the owner and the master keep theirs), password as `/kuutti/staging/db-preview-password`. The master password stays inside the script's process.

   ```sh
   infra/scripts/db-app-role.sh staging
   ```

2. **Dokploy.** The first boot installs Docker and Dokploy `v0.30.6` (variable `dokploy_version`) from the installer vendored at `modules/compute/installer/` and embedded in user data, verified by hash on the box. Port 3000 is never opened; reach the UI through a port forward, create the admin account, and keep its credentials in the password manager:

   ```sh
   aws ssm start-session --target "$(tofu output -raw instance_id)" --document-name AWS-StartPortForwardingSession --parameters portNumber=3000,localPortNumber=3000
   ```

   In the UI, only what creates credentials: the admin account, its two-factor authentication (Settings, Profile) and an API key from the same page. Everything else is `infra/scripts/dokploy-setup.sh <env>`, run with `DOKPLOY_URL=http://localhost:3000` and the key exported as `DOKPLOY_TOKEN`: one project named after the environment, one application `api` deployed from the GHCR image (#8), the domain `api.staging.kuutti.app` or `api.kuutti.app` with Let's Encrypt through Traefik on container port 3000, Dokploy's own domain, and the first deployment. Run it again after a change; it updates what exists. The application environment it sets is exactly `NODE_ENV=production`, `APP_ENV=staging` (or `production`), `PORT=3000`; everything else comes from SSM through the instance role, never from Dokploy (the image itself sets `AWS_REGION` and `DB_SSL_ROOT_CERT`, so the SDK finds the region and pg verifies RDS with the bundled root certificates). Logs need no setting: user data makes `awslogs` the Docker daemon's default driver, so every container on the box, the API included, writes to `/kuutti/<env>/api` under a stream named after the container. DNS is code: `envs/<env>/dns.tf` points `api` and `dokploy` (on staging also `*.preview.api`) at the Elastic IP, so the names resolve minutes after the apply and Traefik can obtain its certificates.

3. **Deploy path.** `deploy.yml` calls Dokploy's API from GitHub, so the control plane must be reachable over HTTPS: Dokploy's own domain (`dokploy.staging.kuutti.app` or `dokploy.kuutti.app`, set by `dokploy-setup.sh`, else under Settings, Web Server) with Let's Encrypt; port 3000 stays closed, Traefik serves the UI and API on 443. Then, for each GitHub environment, three variables and one secret (`gh secret set` prompts for the value; never paste it into a command line; the setup script prints the exact commands with the application id):

   ```sh
   gh variable set DOKPLOY_URL --env staging --body https://dokploy.staging.kuutti.app
   gh variable set DOKPLOY_APPLICATION_ID --env staging --body <id from the application's URL in Dokploy>
   gh variable set API_URL --env staging --body https://api.staging.kuutti.app
   gh secret set DOKPLOY_TOKEN --env staging
   ```

   After the first image push, make the GHCR package public once (package settings, Danger zone, Change visibility) so the box pulls without a credential.

4. **Checks.** From the box (`aws ssm start-session --target <instance-id>`, shell `ssm-user`, `sudo -i` for root). Everything typed and printed in a session is streamed to `/kuutti/ssm-sessions`, so a secret must never be printed there; the forms below keep the value inside the shell:

   ```sh
   aws ssm get-parameter --name /kuutti/<other env>/db-host                     # must be refused
   PGPASSWORD="$(aws ssm get-parameter --name /kuutti/<env>/db-app-password --with-decryption --query Parameter.Value --output text)" \
     psql "host=$(aws ssm get-parameter --name /kuutti/<env>/db-host --query Parameter.Value --output text) dbname=kuutti user=kuutti_app sslmode=verify-full sslrootcert=/etc/kuutti/rds-ca.pem" -c 'select 1'
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

**Trust.** A preview runs a pull request's code on the staging box before anyone has reviewed it, with the staging instance role: it can read every `/kuutti/staging/*` parameter (from M2 that includes the staging hetu HMAC key and the Telia test-bed key), and its Dokploy token can attach any host name, the staging API's included, to a preview container. Opening a pull request from this repository therefore means staging-level trust, and since updates are not code-signed, the trust of a push to `main` (ADR-004). Today the only accounts that can push a branch are the organisation's three owners, who have that trust already, so the `preview` environment has no required reviewer: it would stop nobody and cost an approval per lane on every run. **Before anyone who is not an owner gets write access, switch the reviewer on** (the command below); from then on a preview deploys only after the maintainer has read the diff. The separate database role above keeps preview code out of staging data by construction. Three more things bound a preview: previews drop `DB_APP_PASSWORD` from their configuration at boot (`config.ts`), so the shared prefix does not put the environment's own database in a preview's memory; `dokploy-preview.sh` attaches only `pr-<n>.<preview domain>` hosts, and the box pins `dokploy.<env>` and `api.<env>` with priority Traefik routers (`00-control-plane.yml`, written by user data and `dokploy-setup.sh`), so a member token cannot take the control plane or the staging API even with the script edited; and `preview-cleanup.yml` uses the same environment, so once the reviewer is on, a closed preview waits for the same click (if that becomes a cost, the way out is a cleanup that runs the base branch's workflow file only, not a second unreviewed environment holding the same tokens).

```sh
# Switch the reviewer on (before the first non-owner gets write access):
gh api -X PUT "$R/environments/preview" --input - <<'JSON'
{"wait_timer":0,"reviewers":[{"type":"User","id":9991098}],"prevent_self_review":false,"deployment_branch_policy":null}
JSON
```

Related, for the milestones that touch it: the Dokploy member never gets the volume or mount permissions (a bind mount of the Docker socket is root on the box); updates are not code-signed (ADR-004: Expo sells signing with its paid plans only), so the `EXPO_TOKEN` in `preview` could publish to any branch, the ones behind `staging` and `production` included, from a pull request's edited workflow or from anything its install and `eas` steps execute: that is why a preview is as trusted as a push to `main`, why the reviewer goes on with the first non-owner, and why approving a run then means having read the whole diff, the lockfile and `apps/mobile`'s build configuration included (the native lane bundles in a step without the token for the same reason); and at M2 previews must keep running against the mock IdP (rules/mobile.md), so `parseConfig` will refuse `APP_ENV=preview` with a real Telia issuer. The release path's own gap, that a pull request holding `packages: write` can push any tag of the API image and a later release tag would retag it, predates previews and is tracked separately (build provenance attestation, #8 follow-up).

Once, after staging is applied and its Dokploy is configured:

1. **Preview role.** `kuutti_preview` from step 1 above; on a staging instance whose role script ran before #9, re-run only that part by hand through the same tunnel.
2. **DNS.** Nothing to do: `*.preview.api.staging.kuutti.app` is declared in `envs/staging/dns.tf`. Traefik issues one Let's Encrypt certificate per preview host.
3. **Dokploy.** A project `previews`; its default environment holds the applications, and its id (from the environment's URL in Dokploy) is `DOKPLOY_ENVIRONMENT_ID`. A member user `ci-preview` (Settings, Users) with access to the `previews` project and that environment only, permissions to create and delete services and to create domains, nothing else (no volumes, no Traefik files, no Docker access); sign in as that member and generate its API key. The staging `api` application stays out of the member's reach. Check as the member that `application.one` on the staging application's id is refused before enabling previews.
4. **EAS.** Once in `apps/mobile`: `eas init` writes `extra.eas.projectId` into `app.json`, commit it. The first hosting deploy picks the subdomain that every preview alias hangs off: `npx expo export --platform web && eas deploy --dev-domain kuutti`; that name is `EAS_HOSTING_SUBDOMAIN`. On expo.dev, a robot user with the Hosting and Update permissions provides `EXPO_TOKEN`. The native lane starts publishing when #10 adds `expo-updates` (`updates.url` in `app.json`); nothing here changes then.
5. **Bootstrap.** `tofu apply` in `infra/bootstrap` for the plan role's `preview-cleanup` policy (it may send exactly the document below to exactly the staging box). The next staging apply lands the document `kuutti-staging-preview-database`.
6. **GitHub.** The environment `preview` without a required reviewer while only the organisation's owners can push (Trust, above, has the command that switches it on and says when) and no deployment branch restriction (pull requests deploy from any branch of this repository), four variables and two secrets, then the switch:

   ```sh
   R=repos/kuutti-fi/kuutti-app
   gh api -X PUT "$R/environments/preview" --input - <<'JSON'
   {"wait_timer":0,"reviewers":[],"deployment_branch_policy":null}
   JSON
   gh variable set DOKPLOY_URL --env preview --body https://dokploy.staging.kuutti.app
   gh variable set DOKPLOY_ENVIRONMENT_ID --env preview --body <id>
   gh variable set PREVIEW_API_DOMAIN --env preview --body preview.api.staging.kuutti.app
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
| `/kuutti/<env>/telia-signing-key` | API; signs the request object and the `private_key_jwt` client assertion of the Telia exchange (docs/vendors/telia.md) | #32 |
| `/kuutti/<env>/telia-encryption-key` | API; decrypts the ID token Telia encrypts to us | #32 |
| `/kuutti/<env>/cloudfront-signing-key` | API; signs photo URLs (ADR-005); the public half is `envs/<env>/cloudfront-signing-key.pub.pem` in the repository | #48, at the media cutover |
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

The two Telia keys are RSA, 3072 bits (Telia's minimum is 2048), one for signing (`sig`) and one for encryption (`enc`), generated onto the same offline medium; the private halves go to SSM, the public halves to Telia as JWKs (`docs/vendors/telia.md`, section 2.1 of the guide). The `kid` of each JWK is the key's RFC 7638 thumbprint, nothing chosen: Telia names our `enc` key by it in every ID token's JWE header (guide 2.6.3) and the API computes the same value from the private key at boot (`keyIdOf`) and logs both kids under "bank identification", so what Telia registered and what the API decrypts with cannot disagree. Keep the registered kids in `docs/vendors/telia.md`.

```sh
for use in sig enc; do
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /Volumes/<offline-medium>/kuutti-staging-telia-$use.pem
  openssl pkey -in /Volumes/<offline-medium>/kuutti-staging-telia-$use.pem -pubout -out /Volumes/<offline-medium>/kuutti-staging-telia-$use.pub.pem
done
aws ssm put-parameter --name /kuutti/staging/telia-signing-key --type SecureString --value "$(cat /Volumes/<offline-medium>/kuutti-staging-telia-sig.pem)"
aws ssm put-parameter --name /kuutti/staging/telia-encryption-key --type SecureString --value "$(cat /Volumes/<offline-medium>/kuutti-staging-telia-enc.pem)"
# The public keys as JWKs for Telia; the kid is the RFC 7638 thumbprint (the API logs the same value at boot):
node -e 'const c=require("node:crypto");const [pem,use]=process.argv.slice(1);const j=c.createPublicKey(require("node:fs").readFileSync(pem)).export({format:"jwk"});const kid=c.createHash("sha256").update(JSON.stringify({e:j.e,kty:j.kty,n:j.n})).digest("base64url");console.log(JSON.stringify({...j,use,kid,alg:use==="sig"?"RS256":"RSA-OAEP"}))' /Volumes/<offline-medium>/kuutti-staging-telia-sig.pub.pem sig
```

`db-app-password` is created by `scripts/db-app-role.sh`; rotating it is `ALTER ROLE kuutti_app PASSWORD '…'` through the same tunnel, `put-parameter --overwrite`, and a restart of the API. The two signing keys are not random bytes: the CloudFront key is an RSA key pair whose public half becomes a CloudFront public-key resource (M3), and the Telia key is whatever the broker contract specifies (M2); their creation steps land with those milestones. The RDS master password is not managed here at all: `manage_master_user_password = true` leaves it with AWS so it never enters state.

## Placeholder site

`kuutti.app` serves `site/index.html` from Amplify Hosting until there is a product site (ADR-001, 2026-09-18). The app is connected to this repository as a monorepo with root `site`; `amplify.yml` at the repository root is its build spec, and a push to `main` that changes something under `site/` deploys within a minute. Nothing else in the repository triggers it.

Setting it up, once, in the Amplify console (eu-central-1): *Create new app*, GitHub, install the Amplify GitHub App for `kuutti-fi/kuutti-app` only, branch `main`, tick *My app is a monorepo* and enter `site`; the build settings are read from `amplify.yml`. Then *Custom domains*, *Add domain*, pick `kuutti.app` from the Route 53 list, keep the `www` redirect: Amplify issues the certificate and writes the validation and alias records into the zone itself (10 to 30 minutes). Tag the app `Project=kuutti` so it appears under the cost allocation tag. To retire it: delete the app in the console, then the two records it left in the zone.

## What is not here

Dokploy's own configuration (no provider exists; `user_data` installs it, its contents are backed up from `/etc/dokploy`), the registration of the domain itself (its zone and records are code), the Amplify Hosting app for the placeholder site (above), secret values, the EAS account side (the organisation and project, credentials, the robot token; `apps/mobile/README.md`), store setup, the Telia contract, and creation of the AWS account.
