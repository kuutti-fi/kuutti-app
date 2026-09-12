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

## AWS

- The API authenticates with an EC2 instance role scoped to its bucket, Rekognition detect calls, SES send, and its own SSM parameters. No IAM user, no static keys, ever.
- Secrets live in SSM Parameter Store as SecureString and are fetched at boot. The hetu HMAC key and the Telia signing key never enter the Dokploy control plane, the repo, or CI logs.
- RDS sits in the API's VPC; the security group admits only the API instance. Extended Support declined at creation. 35-day PITR. Manual snapshot before a release-tag migration.
- CloudFront: ACM certificate issued in us-east-1; signed URLs for media; cache key excludes the query string for media; the WebSocket behaviour forwards `Sec-WebSocket-*` headers (AllViewer origin request policy).
- S3 lifecycle: research Parquet to Glacier Instant Retrieval after 12 months. Access logging on the research prefix.
- CloudWatch: billing alarm, EC2 status check, RDS free storage, RDS CPU credit balance. Logs via the `awslogs` driver with 30-day retention.
- Not adopted, do not propose: Lambda for images, Redis, RDS Proxy, Secrets Manager, EventBridge Scheduler, X-Ray, Cloudflare, Hetzner, Neon.

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
