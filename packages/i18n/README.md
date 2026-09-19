# @kuutti/i18n

`messages.yaml` is the source of truth for every user-facing string in app, API and admin (#13, TD-17). Rules: `.claude/rules/i18n.md`. Tone and vocabulary: `docs/i18n/tone.md`, `glossary.yaml`.

## Adding or changing text

1. Add a semantic key to `messages.yaml` with `en` and a `description` that tells a translator where the text shows and how much room it has. ICU MessageFormat for arguments and plurals.
2. Finnish is required (`fi`), Swedish warns (`sv`). Write them, or run `pnpm i18n:translate`, which fills what is missing and flags it `machine: { fi: true }`; a native reviewer corrects the text and deletes the flag. `pnpm i18n:translate --review` lists what is still flagged. `admin.*` keys are English only. `legal.*` keys take a `consent_version`, are never sent to the translator and never carry a machine flag.
3. `pnpm i18n:build`, and commit `src/generated/` with the YAML. CI fails when they drift, like the OpenAPI types (ADR-003).
4. Use it: `t("profile.bio.required")`, `t("errors.rate_limited", { seconds })`. An unknown key, a missing argument or a wrong argument type does not compile.

Never inflect a dynamic value: `in {pond}` and `{pond}ssa` fail the check. A pond's case form comes from the database through `formatPond(pond, "inessive", locale)`.

## What is where

| path | what |
|---|---|
| `messages.yaml`, `glossary.yaml` | the text and the product vocabulary |
| `src/generated/` | one catalogue per locale, the `en-XA` pseudo-locale, and `MessageKey` / `MessageParams`; generated, committed |
| `src/index.ts` | `createI18n`, `typedT`, `resolveLocale`, `parseAcceptLanguage`, `formatDate`, `formatNumber`, `formatPond` |
| `src/react.tsx` (`@kuutti/i18n/react`) | `createReactI18n`, `I18nProvider`, `useT` for app and admin; the API never imports it |
| `src/pseudo.ts` (`@kuutti/i18n/pseudo`) | the `en-XA` catalogue, a separate entry so only a dev build bundles it |
| `scripts/` | `build`, `check` (`--release`), `check:ui-strings` (part of `pnpm lint`), `translate` |

## Runtimes

- **App**: `src/lib/locale.tsx` resolves the phone's languages (`expo-localization`) to a catalogue, lets a stored in-app choice beat it, and offers `en-XA` in dev builds. Locales fall back to English per key.
- **API**: `src/lib/i18n.ts` gives each request `c.get("t")` and `c.get("locale")` from `Accept-Language` (the account's stored locale from M2). Error envelopes keep their stable `code`; the `message` follows the request's language.
- **Admin**: English only by decision; it still reads its text from here.

## Checks

`pnpm i18n:check` (CI job `i18n`): the file validates, every key has `fi` (fail) and `sv` (warn), every locale is valid ICU with the source's arguments, no dynamic value is inflected. `--release` (a `v*` tag, a production EAS build) also fails on Finnish that is still machine-translated. `pnpm lint` fails on a user-facing string literal in the clients' TSX.

`pnpm i18n:translate` sends message text, the glossary and the tone guide to the Claude API, and nothing else; credentials come from the developer's environment (`ANTHROPIC_API_KEY` or an `ant auth login` profile) and are never committed.
