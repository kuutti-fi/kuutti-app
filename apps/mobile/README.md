# @kuutti/mobile

Expo SDK 57, dev client, Expo Router, web target for previews. `app/` holds routes only; features live under `src/features/<slice>/`, horizontal code under `src/lib/`. Rules: `.claude/rules/mobile.md`, `.claude/rules/layout.md`.

- `pnpm start` opens the dev client (`expo start --dev-client`). Expo Go is not supported.
- `pnpm web` runs the web target against the local API.
- `pnpm test` runs jest-expo. `pnpm typecheck` runs tsc.

## Builds and updates (EAS, #10)

Native binaries come from EAS Build; JavaScript reaches installed binaries as EAS Updates. The split is the fingerprint rule: `runtimeVersion` follows the `fingerprint` policy, so a change to native code, a native dependency, `app.json` or a config plugin changes the fingerprint and needs a new build, while everything else is an update. `eas-build.yml` compares the fingerprint of `main` with the last finished `development` build and builds only when it differs; `deploy.yml` publishes an update for every deploy. Pull requests never build: the free tier is 15 builds per platform a month (TD-2); they get an update on branch `pr-<n>` instead (#9).

| profile | what | channel | who |
|---|---|---|---|
| `development` | dev client, internal distribution: Android APK, iOS ad hoc for registered devices | `staging` | the team, for day-to-day work against Metro or the staging API |
| `preview` | the app as testers run it, internal distribution | `staging` | staging testers |
| `production` | store build (AAB, IPA), build number incremented on EAS | `production` | releases on `v*` tags; submission is M5 |

Channels follow the deploy promotion (#8): a merge to `main` deploys the staging API and publishes to `staging`; a `v*` tag deploys prod behind the reviewer and publishes to `production`. Every update is signed with the project's key (ADR-004); a binary carries `certs/certificate.pem` and refuses an update signed by any other key. The private key never enters the repository: it lives in the `staging` and `prod` GitHub environments (`EXPO_UPDATES_PRIVATE_KEY`) and in the maintainer's password manager. Rotating it means a new certificate, hence a new fingerprint and new builds for everyone.

### Installing the dev client

Build links are posted as sticky comments on the pinned builds issue (repository variable `EAS_BUILDS_ISSUE`), one comment per profile, replaced on every new build.

- **Android.** Open the build page from the comment on the phone and install the APK. Allow installs from the browser when Android asks.
- **iOS.** Ad hoc distribution installs only on registered devices. Ask the maintainer for the registration link (`eas device:create` prints a URL and a QR code), open it on the phone, install the profile; the next `development` build includes the device (Apple allows 100 per year). Then open the build page on the phone and install.

In the dev client, connect to Metro on your machine for local work (the API URL is derived from the Metro host), or open a published update: the launcher's *Extensions* tab lists EAS Update branches (`staging`, `pr-<n>`), and a pull-request comment's QR code opens that branch directly. The smoke screen shows which API the JavaScript was built for.

### Apple account

M1 uses the maintainer's individual Apple developer account for ad hoc distribution; Apple organisation enrolment waits for the association's Y-tunnus (TD-4). Apple does not convert an individual account into an organisation, so the app record moves by transfer later; the bundle identifier `fi.kuutti.app`, the EAS project and the certificates are unaffected. Nobody but the maintainer needs an Apple login: EAS holds the distribution certificate and the provisioning profiles.

### Setting up EAS, once (maintainer)

1. **Account.** An Expo organisation `kuutti` owned by the project mailbox (TD-4); the maintainer's personal login is a member. In `apps/mobile`: `eas init --account kuutti` writes `extra.eas.projectId` into `app.json` (and `owner`); `eas update:configure` writes `updates.url`. Commit both. Until they are committed, `deploy.yml` and `eas-build.yml` do nothing (`EAS_ENABLED` unset) and the `#9` native lane reports itself dormant.
2. **Signing key.** `certs/certificate.pem` is committed; its private key is in `keys/private-key.pem` on the machine that generated it (gitignored). Put it in the password manager, then into both GitHub environments: `gh secret set EXPO_UPDATES_PRIVATE_KEY --env staging < keys/private-key.pem` and the same for `prod`. The `preview` environment gets it only if you decide pull requests may sign updates (infra/README.md, Previews, Trust); until then the #9 native lane publishes nothing and says why. To regenerate: `npx expo-updates codesigning:generate --key-output-directory keys --certificate-output-directory certs --certificate-validity-duration-years 10 --certificate-common-name Kuutti` then `codesigning:configure`; every device then needs a new build.
3. **Tokens.** On expo.dev, a robot user in the organisation with the Developer role; its access token is `EXPO_TOKEN` in the `staging`, `prod` and `preview` environments (never at repository level): `gh secret set EXPO_TOKEN --env staging`, and the same for the other two. #9 uses the `preview` copy for pull requests. The token cannot forge a signed update, but it can re-point a channel at an older signed one (`eas channel:edit`), so channel edits stay a maintainer action; Expo has no narrower role for a robot.
4. **API URLs.** The bundles built on EAS need the API URL per environment: `eas env:set --environment preview --name EXPO_PUBLIC_API_URL --value https://api.staging.kuutti.app --visibility plaintext` and `--environment production` with the production URL. CI-published updates get the same value from the GitHub environment variable `API_URL`; keep the two equal. `EXPO_PUBLIC_*` is public by definition; nothing secret goes there.
5. **Credentials.** The first build of each platform is interactive: `eas build --profile development --platform android` lets EAS generate and keep the keystore; `--platform ios` signs in with the Apple account, creates the distribution certificate and the ad hoc profile. Then `eas credentials` to upload the push credentials (FCM service account for Android, APNs key for iOS) so M4 needs no native rebuild. After that CI builds non-interactively with `--freeze-credentials` semantics: credentials exist on EAS and never in the repository.
6. **Pinned issue.** Create an issue "Dev client builds", pin it, and `gh variable set EAS_BUILDS_ISSUE --body <number>`.
7. `gh variable set EAS_ENABLED --body true`.

Checks: an Android team member installs the dev client from the link and sees the staging API version; an iOS tester registered by UDID installs from the build page; a JS-only merge to `main` shows up in the dev client's `staging` branch without a new build; a native change on `main` starts new `development` and `preview` builds and the recorded fingerprint changes; `eas update --branch staging --private-key-path <a throwaway key>` is refused by an installed binary; `gh secret list --env <env>` shows `EXPO_TOKEN` only in `staging`, `prod` and `preview`; the project on expo.dev is owned by the organisation.
