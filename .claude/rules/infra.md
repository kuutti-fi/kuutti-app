---
paths:
  - ".github/**"
  - "infra/**"
  - "services/**"
  - "scripts/**"
  - "**/Dockerfile*"
  - "**/docker-compose*.yml"
  - "**/compose*.yml"
---

# Infrastructure, CI, and deployment rules

One AWS account, everything in eu-central-1. Vendor list: AWS, Expo/EAS, GitHub, Telia. Consult `https://docs.dokploy.com/llms.txt` for Dokploy.

## Infrastructure as code (ADR-001)

- OpenTofu, not Terraform (licence) and not CDK or CloudFormation. Commands are `tofu`. The committed lockfile is OpenTofu's.
- Everything AWS is declared under `infra/`. Resources are never created in the console and imported later; the only click-ops is creating the account and running `infra/bootstrap` once.
- State is in S3, one key per environment, versioned and encrypted, `use_lockfile = true`. DynamoDB locking is deprecated and unused. Treat the state bucket as a secret store.
- Secret values never enter state, which means secret SSM parameters are never declared as resources: the AWS provider stores a SecureString's decrypted value in state on every refresh, and `ignore_changes` only suppresses the diff. Secrets are created once with the CLI (see `infra/README.md`) and referenced by path in IAM policies. Non-secret parameters may be resources. RDS uses `manage_master_user_password = true` so AWS holds the master password; that is the one sanctioned use of Secrets Manager, by RDS and not by the application.
- Every IAM role created under `infra/` sets `permissions_boundary` to the bootstrap boundary policy (output `permissions_boundary_arn`). The apply role refuses to create or modify a role without it.
- The plan role runs on every pull request and is denied `kms:Decrypt`, Secrets Manager reads, log reads, and every `s3:GetObject` outside the state bucket. If a plan needs data access, the design is wrong, not the deny.
- CI assumes an AWS role by OIDC. `tofu plan` on every pull request, posted to it; apply to staging on merge to `main`; apply to production only behind the `prod` GitHub environment approval.
- GitHub issues immutable subject claims for this repository (created after 15 July 2026), so the OIDC sub is `repo:kuutti-fi@<owner_id>/kuutti-app@<repo_id>:...`. Trust policies key on the `repository_id` and `repository_owner_id` claims. A name-based `sub` condition copied from older examples will not match.
- Dokploy's own configuration is not in code and cannot be: `user_data` installs it, its contents are backed up from `/etc/dokploy`. That manual step in the recovery path is a live argument in the Dokploy versus Kamal question.
- Run `tofu fmt` before committing. Adding or changing a module needs an ADR or a citation of the TD it follows.

## AWS

- The API authenticates with an EC2 instance role scoped to its bucket, Rekognition detect calls, SES send, and its own SSM parameters. No IAM user, no static keys, ever.
- Secrets live in SSM Parameter Store as SecureString and are fetched at boot. The hetu HMAC key and the Telia signing key never enter the Dokploy control plane, the repo, or CI logs.
- RDS sits in the API's VPC; the security group admits only the API instance. Extended Support declined at creation. 35-day PITR. Manual snapshot before a release-tag migration.
- CloudFront: ACM certificate issued in us-east-1; signed URLs for media; cache key excludes the query string for media; the WebSocket behaviour forwards `Sec-WebSocket-*` headers (AllViewer origin request policy).
- S3 lifecycle: research Parquet to Glacier Instant Retrieval after 12 months. Access logging on the research prefix.
- CloudWatch: billing alarm, EC2 status check, RDS free storage, RDS CPU credit balance. Logs via the `awslogs` driver with 30-day retention.
- Not adopted, do not propose: Lambda for images, Redis, RDS Proxy, Secrets Manager (except the RDS master password, ADR-001), EventBridge Scheduler, X-Ray, Cloudflare, Hetzner, Neon.

## Containers

- Build arm64 images in CI (t4g is arm64); never under QEMU. Pinned base image. Verify sharp's arm64 prebuild after any dependency bump.
- The box is stateless: database on RDS, files on S3. It is rebuildable from the Dokploy config.

## CI (GitHub Actions)

- Actions pinned to commit SHAs with a version comment; repository settings reject unpinned actions. `permissions: contents: read` at the top of every workflow, raised per job only when needed.
- Jobs: typecheck, Biome, Vitest (api, packages), jest-expo (mobile), secret scan, DCO. arm64 runners for anything that builds images.
- Cloud access from CI through OIDC federation only. No long-lived AWS keys in repository secrets.
- `pnpm install --frozen-lockfile`; `pnpm audit` blocks on high.

## Deploy

- Every merge to `main` deploys staging. Production is a release tag `vX.Y.Z` deployed from the same image. EAS Update channels `staging` and `production` follow the same promotion.
- PR previews: an Expo web build per PR, plus a Dokploy preview whose entrypoint creates `kuutti_pr_<n>` on the staging RDS instance, migrates, seeds, and drops it on close. Never production data in a preview.
- Hotfix: branch from the last tag, PR, tag, merge back.
- Dokploy versus Kamal is open; do not switch without an ADR.

## Local dev

- `docker compose up` provides Postgres, MinIO as the S3 stand-in, and the mock IdP (`navikt/mock-oauth2-server`) whose login page accepts arbitrary FTN claims. The real Telia test bed is wired only on staging.
