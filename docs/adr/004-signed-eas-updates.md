# ADR-004: Signed EAS Updates and custody of the signing key

- Status: accepted
- Date: 2026-09-15
- Follows: TD-2 (Expo/EAS as the native shell and update channel), the security checklist's "Software and data integrity failures"

## Context

JavaScript reaches installed binaries as EAS Updates (#10): every merge to `main` publishes to the `staging` channel, every release tag to `production`. An update is code that runs inside a bank-verified identity app on real phones, so whoever can publish to `production` can change what those phones run without a store review. The Expo account, its robot token and the GitHub workflows are all links in that chain; the checklist requires updates to be code-signed so that the token alone is not enough.

`expo-updates` supports code signing: the binary carries a certificate, every update manifest is signed with the matching private key, and a client refuses an unsigned or mis-signed manifest. The private key has to be present wherever `eas update` runs.

## Decision

1. **Updates are signed.** `apps/mobile/certs/certificate.pem` (public, self-signed, ten years) is committed and referenced from `app.json` as `updates.codeSigningCertificate`; `codeSigningMetadata` names key `main` with `rsa-v1_5-sha256`. Every binary from `eas.json`'s profiles embeds it; a client rejects anything else. The key pair is generated with `npx expo-updates codesigning:generate` and never leaves the machine that generated it except through the steps below.
2. **The private key lives in the GitHub environments that publish, and in the maintainer's password manager.** `EXPO_UPDATES_PRIVATE_KEY` in `staging` and `prod`; `deploy.yml` writes it to a file in one step whose only command is `printf`, runs `eas update --private-key-path` in the next step where the key is a path and nothing else, and removes the file afterwards. Not an EAS environment variable: a secret-visibility EAS variable is readable only on EAS servers, and our publishes run on GitHub runners. Not in the repository: `.gitignore` ignores every PEM and un-ignores exactly the certificate; CI fails on any tracked private key.
3. **Pull-request previews sign only if the maintainer says so.** The `preview` environment holds the key only by a deliberate decision (infra/README.md, Previews, Trust): a pull request's edited workflow could sign an update for any branch. Until then the native preview lane reports itself unsigned and publishes nothing; a dev client would refuse the update anyway.
4. **Rotation is a rebuild.** The certificate is part of the runtime, so a new key pair means a new certificate, a new fingerprint and new builds for every device. Rotation therefore happens only on compromise or expiry, with the old builds retired.

## Consequences

- The robot token (`EXPO_TOKEN`) alone can start builds and publish updates that no client accepts on `production` or `staging`; it can still re-point a channel at an older, validly signed update group. Channel edits are therefore a maintainer action, never a workflow's.
- A leaked key is a full compromise of the update path until the next builds ship; the environments holding it are the two with the deploy tokens, no more.
- The dev client refuses unsigned updates too, so every published branch, `pr-<n>` included, needs the key; that is the price of one client behaviour for every channel.
- The same holds for Metro: the dev client asks the local dev server for a signed manifest and refuses to load without one, so `expo start` needs `--private-key-path` and local work in the dev client needs the key on the developer's machine. `pnpm env:up` and `pnpm dev:mobile` pass `apps/mobile/keys/private-key.pem`; the web target needs no key. While the maintainer is the only developer this costs nothing. Before a second developer uses the dev client the question has to be settled by amending this ADR (a development profile with its own certificate, or without one), not by handing out the production key.

## Alternatives considered

**Unsigned updates, trust in the token.** Simpler, and the token is already secret. Rejected: the checklist requires signing, and the token sits in three GitHub environments and an Expo account outside our infrastructure.

**Key as an EAS file variable.** Would keep the key inside Expo. Rejected: publishes run from GitHub Actions, where a secret EAS variable is unreadable; making it sensitive instead would print it to CLI output.

**Signing in an EAS Workflow.** EAS Workflows could publish from EAS's own runners with the key never leaving Expo. Not adopted now: it moves deploy orchestration to a second CI system for one step; revisit if EAS Workflows become the build path.
