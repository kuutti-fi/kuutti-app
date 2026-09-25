# ADR-004: EAS Updates are not code-signed; what guards the update path instead

- Status: accepted, amended 2026-09-19 twice (the original decision, signed updates, is withdrawn; the `preview` reviewer is conditional on who can push; see History)
- Date: 2026-09-15
- Follows: TD-2 (Expo/EAS as the native shell and update channel), the security checklist's "Software and data integrity failures"

## Context

JavaScript reaches installed binaries as EAS Updates (#10): every merge to `main` publishes to the `staging` channel, every release tag to `production`. An update is code that runs inside a bank-verified identity app on real phones, so whoever can publish to `production` can change what those phones run without a store review. The Expo account, its robot token and the GitHub workflows are all links in that chain.

`expo-updates` supports code signing: the binary carries a certificate, every update manifest is signed with the matching private key, and a client refuses an unsigned or mis-signed manifest. The original decision here was to sign every update so that the token alone would not be enough.

That decision assumed signing was available to us. It is not: Expo's servers refuse to publish a signed update for an account without a paid subscription. The first publish from `deploy.yml` (run 35454641491, 2026-09-19) ended with "EAS Update code signing requires a subscription to the EAS Enterprise plan. This account (kuutti) currently does not have a subscription plan"; Expo's documentation offers it on the Production plan (199 USD a month) and Enterprise. Kuutti is free, non-commercial and runs on the free tier (TD-2); a subscription for one control is not proportionate at this stage, and the maintainer decided against it.

## Decision

1. **Updates are not code-signed, for now.** `app.json` carries no `updates.codeSigningCertificate`; the certificate is removed from the repository, the `--private-key-path` flags from the dev scripts and the key steps from `deploy.yml` and `preview.yml`. No workflow reads `EXPO_UPDATES_PRIVATE_KEY` any more; the maintainer deletes it from the `staging` and `prod` environments. `runtimeVersion` stays on the `fingerprint` policy, which is compatibility and not protection: whoever can publish also chooses the runtime string an update claims.
2. **The authority to publish is the Expo organisation and its robot token.** `EXPO_TOKEN` exists only in the GitHub environments `staging`, `prod` and `preview`, never at repository level and never in an EAS or Dokploy variable. Expo has no narrower role for a robot, so each copy can publish to any branch and re-point any channel: the three environments are equally sensitive and the weakest gate is the real one. `prod` admits only `v*` tags behind the maintainer as required reviewer; `staging` admits only `main` and has no reviewer; `preview` admits any ref of this repository and, while clause 3's condition is not met, has no reviewer either. What can publish to `production` is therefore whatever lands on `main`, any branch pushed to this repository (through its preview run), a run approved into `prod`, and the GitHub organisation's owners. Those three owners, who are the only accounts that can push here, the Expo organisation's two human logins (the owner login and the maintainer's Admin) and Expo itself are the trust boundary of the update path. 2FA on both human Expo logins is a checklist item in `docs/runbooks/custody.md` that this decision makes urgent. Channel edits (`eas channel:edit`) remain a maintainer action, never a workflow's.
3. **Pull-request previews publish on their own branch; the reviewer on `preview` follows who can push.** The native lane of `preview.yml` publishes to `pr-<n>` with the `preview` environment's token. No channel points at a `pr-<n>` branch, so an installed build only loads one when a person opens it from the dev client. The token is not branch-scoped, so a preview run is as trusted as a push to `main`. While the only accounts that can push a branch are the organisation's owners, who can push to `main` and bypass environment protection anyway, a required reviewer on `preview` stops nobody and costs an approval per lane on every run and every cleanup; it is off (removed 2026-09-19). **It is switched on before anyone who is not an owner gets write access** (`docs/runbooks/custody.md`, `infra/README.md` Previews), and from then on approving a preview run means having read the whole diff, the lockfile and `apps/mobile`'s build configuration included. Independent of the reviewer, the lane bundles in a step that does not hold the token and publishes the finished bundle (`eas update --skip-bundler`), so a pull request's Metro, Babel and build configuration never see it. Forks and Dependabot get no secrets and no preview.
4. **Signing returns before it matters most, and the way back is known.** Before the first production build reaches people outside the team (the M5 store release at the latest) this ADR is reopened. The options then: Expo's paid plan, or serving updates ourselves (the `expo-updates` protocol from the API and S3, where code signing is free) under its own ADR. Either way a certificate in `app.json` changes the fingerprint, so re-enabling signing is a new key pair (`npx expo-updates codesigning:generate`) and a new build for every device; nothing from the withdrawn key pair is kept for it.

## Consequences

- A leaked or misused `EXPO_TOKEN`, or a compromised Expo account, can publish JavaScript that installed builds on the matching channel will run. With signing that needed the key as well. Until M2 the binaries hold nothing worth stealing (a smoke screen against staging); the exposure grows with identity (M2) and real users (M5), which is what clause 4 is tied to.
- A branch pushed to this repository runs its preview with a token that could publish to `production`, and so does every push to `main`; no reviewer gates either today, because the same three people could bypass one. The `prod` environment's approval protects the production API deploy; it does not protect the `production` update channel on its own.
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
- 2026-09-19, later: the required reviewer on `preview`, briefly described here as a condition of this ADR, removed by the maintainer: everyone it could stop can bypass it. Clause 3 now ties it to the first non-owner with write access.
- 2026-09-25: the condition of clause 3 is met. The `contributors` team (Hilal, Ilya, Dereden, Nanna) got write on the repository for M3, the maintainer became the required reviewer on `preview` the same hour, and the `main` ruleset gained the pull-request rule (one approving review for non-admins, squash only, the fourteen every-pull-request checks required). What can publish to `production` is unchanged by the team: a contributor's branch reaches a preview run only after the maintainer's approval, and `main` only through a reviewed pull request.
