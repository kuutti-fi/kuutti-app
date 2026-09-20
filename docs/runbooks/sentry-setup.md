# Sentry, once (maintainer)

Error reporting only (TD-19, #11): unhandled errors from the API and the app, with readable stack traces. No tracing, no session replay, no user data: the code strips request bodies, headers and breadcrumb data before anything leaves (`apps/api/src/lib/sentry.ts`, `apps/mobile/src/lib/sentry.ts`, both asserted by tests). Until a DSN is configured the SDK is off everywhere, which is today.

The site is sentry.io. **The data region is chosen when the organisation is created and cannot be changed afterwards: choose the EU.** The organisation then lives at `https://kuutti.sentry.io` and its API at `https://de.sentry.io`, which is what `app.json` and the upload step already point at.

## 1. Account and organisation

1. https://sentry.io/signup/ with the project mailbox (TD-4: accounts belong to the association), not a personal address. Turn on two-factor authentication in User settings, Security, before anything else, and add the entry to `docs/runbooks/custody.md`.
2. Create the organisation: name `Kuutti`, slug **`kuutti`** (the code expects it), **Data storage location: European Union (EU)**.
3. Plan: the free Developer plan is enough for M1 (one user, a monthly error quota). Sentry also sponsors open-source projects; applying is worth the ten minutes once the repository has some history.
4. Organisation settings, Security & Privacy: turn on **Require two-factor authentication** and **Enhanced privacy**; leave "Data scrubber" and "Use default scrubbers" on. Set **Prevent storing of IP addresses** on.

## 2. Two projects

| project slug | platform to pick | used by |
|---|---|---|
| **`api`** | Node.js | `apps/api` |
| **`mobile`** | React Native | `apps/mobile` |

Skip the setup wizards: the SDKs are already wired. For each project open Settings, Client Keys (DSN) and copy the **DSN**. A DSN is public by design (it only allows sending events), so it is not handled as a secret.

In each project's Settings, General: alert emails to the project mailbox; in Alerts keep the default "new issue" rule and nothing more for now.

## 3. The DSNs go where the code reads them

Staging first; production is #25.

```sh
pnpm aws:login
aws ssm put-parameter --name /kuutti/staging/sentry-dsn --type String --value '<api DSN>'
cd apps/mobile
pnpm exec eas env:create --environment preview --name EXPO_PUBLIC_SENTRY_DSN --value '<mobile DSN>' --visibility plaintext
```

The API reads `/kuutti/staging/sentry-dsn` as `SENTRY_DSN` at boot; the app gets `EXPO_PUBLIC_SENTRY_DSN` at build and update time from the EAS environment `preview`, which is the one staging builds and updates use.

## 4. The token that uploads source maps

Without source maps the app's stack traces are unreadable. Settings, Developer Settings, **Organization Tokens**, Create New Token, name `ci-source-maps`. (A personal token works too; it then needs the scopes `project:releases` and `org:read` and nothing more.) It is shown once. It is a secret and lives in exactly these places, never at repository level:

```sh
gh secret set SENTRY_AUTH_TOKEN --env staging        # paste at the prompt: updates published by deploy.yml
cd apps/mobile && pnpm exec eas env:create --environment preview --name SENTRY_AUTH_TOKEN --visibility secret   # native builds on EAS
```

Add the token to the password manager entry. Production's copies are part of #25.

## 5. Prove it

1. Redeploy staging (any push to `main`, or re-run the latest Build workflow). `aws logs tail /kuutti/staging/api --since 10m | grep "error reporting"` must show `"reporting":true`.
2. **API:** the box can send one marked error at boot, and nothing from outside can trigger it:
   ```sh
   aws ssm put-parameter --name /kuutti/staging/sentry-self-test --type String --value true
   # redeploy, then:
   aws ssm delete-parameter --name /kuutti/staging/sentry-self-test
   ```
   In Sentry, project `api`: an issue "Sentry self-test: the API booted with SENTRY_SELF_TEST=true", environment `staging`, a readable stack trace, and **no request data** on the event. Redeploy once more so the flag is gone from the running process.
3. **App:** the next update or build after step 3 has the DSN. Open the app (a `preview` or `development` build), the settings icon at the top left, **Send a test error**. In Sentry, project `mobile`: "Sentry test from the settings sheet" with frames that name `DevSettings.tsx`, not `index.android.bundle:1:234567`. If the frames are unreadable, the source maps did not upload: check the "Upload the update's source maps" step of the Deploy job.
4. Tick #11's first and last box with links to the two issues in Sentry, and delete the two test issues.

## What Sentry must never receive

Message text, hetu, email, `seeks`, request bodies, query strings, cookies, IP addresses. The code strips them and tests assert it; the organisation settings of step 1 are the second layer. If an event ever shows any of these, turn the DSN off first (`aws ssm delete-parameter --name /kuutti/<env>/sentry-dsn`, redeploy) and ask questions afterwards.
