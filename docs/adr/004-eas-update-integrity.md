# ADR-004: EAS Updates are not code-signed; what guards the update path instead

- Status: accepted, amended 2026-09-19 (the original decision, signed updates, is withdrawn; see History)
- Date: 2026-09-15
- Follows: TD-2 (Expo/EAS as the native shell and update channel), the security checklist's "Software and data integrity failures"

## Context

JavaScript reaches installed binaries as EAS Updates (#10): every merge to `main` publishes to the `staging` channel, every release tag to `production`. An update is code that runs inside a bank-verified identity app on real phones, so whoever can publish to `production` can change what those phones run without a store review. The Expo account, its robot token and the GitHub workflows are all links in that chain.

`expo-updates` supports code signing: the binary carries a certificate, every update manifest is signed with the matching private key, and a client refuses an unsigned or mis-signed manifest. The original decision here was to sign every update so that the token alone would not be enough.

That decision assumed signing was available to us. It is not: Expo's servers refuse to publish a signed update for an account without a paid subscription. The first publish from `deploy.yml` (run 35454641491, 2026-09-19) ended with "EAS Update code signing requires a subscription to the EAS Enterprise plan. This account (kuutti) currently does not have a subscription plan"; Expo's documentation offers it on the Production plan (199 USD a month) and Enterprise. Kuutti is free, non-commercial and runs on the free tier (TD-2); a subscription for one control is not proportionate at this stage, and the maintainer decided against it.

## Decision

1. **Updates are not code-signed, for now.** `app.json` carries no `updates.codeSigningCertificate`; the certificate is removed from the repository, the `--private-key-path` flags from the dev scripts and the key steps from `deploy.yml` and `preview.yml`. No workflow reads `EXPO_UPDATES_PRIVATE_KEY` any more; the maintainer deletes it from the `staging` and `prod` environments. `runtimeVersion` stays on the `fingerprint` policy, which is compatibility and not protection: whoever can publish also chooses the runtime string an update claims.
2. **The authority to publish is the Expo organisation and its robot token.** `EXPO_TOKEN` exists only in the GitHub environments `staging`, `prod` and `preview`, never at repository level and never in an EAS or Dokploy variable. Expo has no narrower role for a robot, so each copy can publish to any branch and re-point any channel: the three environments are equally sensitive and the weakest gate is the real one. `prod` admits only `v*` tags and `preview` any ref of this repository, both behind the maintainer as required reviewer; `staging` admits only `main` and has no reviewer. What can publish to `production` is therefore whatever lands on `main`, a run approved into `preview` or `prod`, and the GitHub organisation's owners, who can push to `main` and bypass environment protection (`can_admins_bypass`). Those three owners, the Expo organisation's two human logins (the owner login and the maintainer's Admin) and Expo itself are the trust boundary of the update path. It narrows when `main` requires a reviewed pull request (#8's ruleset switch) and if admin bypass is switched off on the three environments; both are the maintainer's actions. 2FA on both human Expo logins is a checklist item in `docs/runbooks/custody.md` that this decision makes urgent. Channel edits (`eas channel:edit`) remain a maintainer action, never a workflow's.
3. **Pull-request previews publish on their own branch, behind the reviewer.** The native lane of `preview.yml` publishes to `pr-<n>` with the `preview` environment's token. No channel points at a `pr-<n>` branch, so an installed build only loads one when a person opens it from the dev client. The token is not branch-scoped: what keeps a pull request from publishing elsewhere is the required reviewer on `preview`, which makes that reviewer a condition of this ADR and not a convenience. The lane bundles in a step that does not hold the token and publishes the finished bundle (`eas update --skip-bundler`), so the pull request's Metro, Babel and build configuration never see it; `eas-cli` from the pull request's lockfile, app-config evaluation, and anything an earlier step of the job planted still run with it, so approving a preview run means having read the whole diff, the lockfile and `apps/mobile`'s build configuration included.
4. **Signing returns before it matters most, and the way back is known.** Before the first production build reaches people outside the team (the M5 store release at the latest) this ADR is reopened. The options then: Expo's paid plan, or serving updates ourselves (the `expo-updates` protocol from the API and S3, where code signing is free) under its own ADR. Either way a certificate in `app.json` changes the fingerprint, so re-enabling signing is a new key pair (`npx expo-updates codesigning:generate`) and a new build for every device; nothing from the withdrawn key pair is kept for it.

## Consequences

- A leaked or misused `EXPO_TOKEN`, or a compromised Expo account, can publish JavaScript that installed builds on the matching channel will run. With signing that needed the key as well. Until M2 the binaries hold nothing worth stealing (a smoke screen against staging); the exposure grows with identity (M2) and real users (M5), which is what clause 4 is tied to.
- A pull request approved into `preview` runs with a token that could publish to `production`, and so does every push to `main`, which no reviewer gates today. The `prod` environment's approval protects the production API deploy; it no longer protects the `production` update channel on its own.
- Expo itself (its servers and CDN) is trusted to deliver the bytes we published. That was the other thing signing removed, and it cannot be replaced by process on our side.
- The dev client no longer asks Metro for a signed manifest: `pnpm env:up` and `pnpm dev:mobile` need no key, and a second developer needs nothing from the maintainer to run the app locally. Builds made while the certificate was embedded (fingerprint `d9ecc75a` and earlier) keep demanding signed manifests and signed updates: the push of this change starts a new Android `development` build (`eas-build.yml`); any other profile or platform is rebuilt by hand when it is needed.
- Rollback of a bad update is unchanged: republish the previous commit, or `eas update:republish`.

## Alternatives considered

**Pay for the Production plan.** Keeps the original design unchanged. Rejected for now on cost: 199 USD a month is several times what the staging infrastructure costs, for a control whose value is low until there are users.

**Self-host updates now.** The `expo-updates` protocol is open and self-hosted manifests can be signed for free. Rejected for now: a new server path, storage layout and rollout tooling in Milestone 1, for binaries that do nothing yet. It is the likely answer to clause 4.

**No over-the-air updates at all: every change is a build.** Removes the update path and its risk entirely. Rejected: the free tier is 15 builds per platform a month (TD-2), and staging would stop following `main`.

**Keep the certificate in the binary and publish nothing until signing is possible.** Rejected: the dev client would keep demanding a signed Metro manifest for local work, for no protection in return, and staging testers would see no updates.

## History

- 2026-09-15: accepted as "Signed EAS Updates and custody of the signing key": certificate committed, private key in the `staging` and `prod` GitHub environments and the maintainer's password manager, pull-request previews unsigned and therefore unpublished.
- 2026-09-17: key pair regenerated after the maintainer's machine was rebuilt.
- 2026-09-19: first publish attempt refused by Expo for lack of a paid plan; signing withdrawn as above.
