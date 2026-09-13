# Kuutti

Free, non-commercial, open-source dating app for Finland, run by a registered association. Every account is verified through Finnish bank ID via the Telia broker. Licence: AGPL-3.0 with App Store exception (`LICENSE`, `LICENSE-EXCEPTION`). This file carries the standing rules. The reasoning behind them, the technical decisions log (TD-1 to TD-19) and the design evidence base, lives in the maintainers' private planning documents; ask the maintainer when a rule here needs its reasoning. Where anything here conflicts with the decisions log, the log wins.

Before touching matching, rounds, likes, notifications, rewards, profile presentation, or research events, read the Product constraints section below and confirm parameters with the maintainer. Read `docs/security-checklist.md` before touching identity, auth, uploads, signed URLs, events, or infrastructure.

## Layout (pnpm monorepo, `node-linker=hoisted`)

| path | what | rules |
|---|---|---|
| `apps/mobile` | Expo SDK 57, RN 0.86, React 19, TypeScript, dev client, web preview target | `.claude/rules/mobile.md` |
| `apps/api` | Hono on Node, WebSockets via `@hono/node-ws`, nightly jobs | `.claude/rules/api.md` |
| `apps/admin` | Vite + React moderation panel, static behind CloudFront | `.claude/rules/admin.md` |
| `packages/schema` | zod contracts shared by all apps; research event registry | `.claude/rules/schema.md` |
| `packages/db` | Drizzle schema, generated migrations, seed | `.claude/rules/db.md` |
| `packages/i18n` | `messages.yaml`, typed `t()`, i18next + ICU | `.claude/rules/i18n.md` |
| `services/mock-idp` | navikt/mock-oauth2-server with FTN-shaped claims for local dev | `.claude/rules/infra.md` |
| `docs/` | security checklist, `adr/` | |
| `features/` | Gherkin specs for the rules layer, one directory per slice | `.claude/rules/layout.md` |

Inside each app, code is organised by vertical slice (identity, profile, media, pond, matching, chat, safety, research, rewards, notifications), never by layer; see `.claude/rules/layout.md`. Rules in `.claude/rules/` load automatically when you work on matching paths. The scaffold is Milestone 1; until it lands, treat this layout as the target, not a description.

## Commands

Root `package.json` is the source of truth; keep this list in sync with it.

- `pnpm install --frozen-lockfile`. Node 22.18+ and pnpm come from `package.json` (`engines`, `packageManager`); run `corepack enable` once.
- `pnpm dev` runs the API with tsx watch on port 3000. `pnpm dev:mobile` starts the Expo dev client; never Expo Go. `pnpm dev:admin` starts Vite.
- `pnpm typecheck`, `pnpm lint` (Biome, including the slice import boundary), `pnpm format`, `pnpm test` (Vitest for api and packages, jest-expo for mobile).
- `pnpm check:scenarios` verifies every Gherkin scenario has a same-named test.
- `pnpm openapi` regenerates `apps/api/openapi.json` and the typed client paths in `packages/schema` from the route contracts (ADR-003); CI fails on drift.
- API tests need Postgres: `DATABASE_URL`, or the local default `postgres://kuutti:kuutti@127.0.0.1:5432/kuutti_test`.
- `pnpm --filter @kuutti/db generate --name <what>` after a schema change; commit the SQL and `drizzle/meta`, never edit them. `pnpm --filter @kuutti/db migrate` and `seed -- --env development`; seed refuses production. `pnpm check:schema-words` rejects columns for hetu, sex, or date of birth. `pnpm i18n:translate` (#13).
- `docker compose up` for Postgres, MinIO, and the mock IdP (#5).

Before pushing: typecheck, lint, and tests pass locally. Do not push red.

## Git

- `main` only. Direct pushes until the PR flow starts; the switch to PR + green CI (TD-2) is announced by the maintainer, not assumed.
- Every commit is signed off (`git commit -s`). Enable the hook once per clone: `git config core.hooksPath .githooks`. The DCO workflow fails on unsigned commits.
- Linear history: no merge commits, no force-push, never touch the branch ruleset or repository settings.
- Subject line imperative and under 72 characters; the body says what and why. Cite the TD or ADR when a change follows one.
- Commit only what was asked. No generated artefacts, no unrelated lockfile churn, no `.env*`.

## Non-negotiable rules

From TD-1, TD-6, TD-7. A change that violates one is wrong regardless of who asked.

1. The personal identity code (hetu) is never persisted. It exists in memory during the OIDC callback, yields age and `HMAC-SHA256(hetu)`, and is discarded.
2. The HMAC key is never rotated and never leaves SSM Parameter Store (fetched at boot via the instance role, one offline backup).
3. Legal sex from the hetu is never stored. Gender is self-declared. Age is `birth_year` + `birth_month` only.
4. Uploads go through the API: validate, strip EXIF, re-encode with sharp, generate variants, discard the original. No direct-to-S3 path.
5. Research events never contain message text and are keyed by `research_id`, never `account_id`.
6. Every user-data query is scoped by the session's `account_id` in the query itself.
7. Hard filters are never violated, in either direction, for any reason.
8. No web surface for the product: no profile pages, share links, browser client, or CORS.
9. `.env` files are never read, written, logged, or committed. `.claude/settings.json` denies them at tool level; do not work around it with shell commands. The committed template is `env.example` with placeholders only.
10. Migrations are generated by drizzle-kit, never hand-written, and applied by the entrypoint under an advisory lock.

## Security and privacy defaults

- Secrets: SSM in deployed environments, a local `.env` for dev. Never print, echo, or commit a secret; never paste user data or secrets into any external service or LLM.
- Logs: structured, carrying `account_id` and request id, never hetu, message text, email, or `seeks`.
- New dependency: check it is maintained, pin it, and note any `postinstall` script in the PR. `pnpm audit` on high blocks CI.
- GitHub Actions: pin to commit SHAs (enforced by repo settings), `permissions: contents: read` unless a step needs more, cloud access by OIDC only.
- When a change touches the four security surfaces (Telia OIDC exchange, hetu HMAC, session tokens, signed URL issuance) run the `security-reviewer` agent on the diff before committing.

## Code

- TypeScript strict everywhere. No `any` in exported signatures; `unknown` plus a zod parse at the boundary.
- Biome is the formatter and linter; its config is the style guide. Run `pnpm lint` rather than arguing with it.
- Validate at boundaries with schemas from `packages/schema`; trust types inside.
- Small modules, named exports, no barrel files that re-export whole packages (Metro and tree-shaking both suffer).
- Vertical slices, not layers. A slice imports only from `packages/schema`, `packages/db`, its app's `src/lib/`, and a neighbouring slice's `index.ts`. Never reach into another slice's internals; two slices that keep needing each other mean the boundary is wrong. Details in `.claude/rules/layout.md`.
- Comments explain why, not what. Reference the TD or ADR number when the why is a decision.
- English for code, comments, commits, and docs. User-facing strings go through i18n keys, never inline.
- Do not add infrastructure, caching layers, queues, or abstractions for scale that is not coming (5,000 users, one box).
- Prefer the vendor's agent docs over training data for API details: Expo through the official Claude Code plugin and MCP (`claude plugin install expo@claude-plugins-official`), then `https://hono.dev/llms.txt`, `https://orm.drizzle.team/llms.txt`, `https://zod.dev/llms.txt`, `https://www.nativewind.dev/llms.txt`, `https://docs.dokploy.com/llms.txt`, `https://docs.sentry.io/llms.txt`, `https://www.i18next.com/llms.txt`.

## Testing

- Vitest for `apps/api` and `packages/*`; jest-expo for React Native components. Do not mix them.
- Every route: `app.request()` tests for happy path, validation failure, unauthenticated, and wrong-user. Real Postgres, transaction rolled back per test, never a mocked database.
- Every exported function in `packages/core` and `apps/api/src/identity` has tests. hetu parsing and HMAC derivation get property-based tests with fast-check.
- Coverage thresholds apply only to those two paths. No global coverage number.
- A test fails on PII patterns in log output.
- Tests are deterministic: no real network, no wall-clock dependence, no random data without a seed.
- Rules-layer behaviour (identity, matching, pond, safety, erasure) is specified in `features/<slice>/*.feature`. A `Scenario` is an `it()` with the scenario name verbatim; a `Scenario Outline` is a `describe()` with the outline name around `it.each` over the Examples rows. `pnpm check:scenarios` fails CI on any scenario without a same-named test; `@pending` marks a spec that lands before its code. If a `Given` needs more than three lines of setup, it is not a Gherkin scenario: write an ordinary test. ADR-002.

## Accessibility (mobile and admin)

- Meaning never by colour alone. Pass and like differ in shape, label, and position; no red/green pair.
- WCAG AA contrast on the token set in both themes; high contrast is a second token set, not a separate mode.
- Every touchable has `accessibilityLabel` and `accessibilityRole`; targets are at least 44 pt.
- OS font scaling and reduce-motion are respected; no fixed-height text containers.
- Decisions are buttons, not swipes. A swipe may exist as an accessibility alternative, never as the primary input.

## Product constraints

The evidence base behind these is in the maintainers' private design document. Never build: compatibility or chemistry scores, desirability signals, infinite feeds, real-time engagement push, streaks, leaderboards, boosts or anything purchasable, ads or ad SDKs, pre-match links to external profiles, under-18 access. If asked, refuse and cite this section. Every tunable lives in `matching_config`, not in code.

## Decisions

Anything that changes identity, upload, event flow, data retention, or infrastructure needs an ADR in `docs/adr/`, or a citation of the TD it follows, in the same change. Open questions you must not settle on your own: RPC style across the client-server boundary (lean: generated types via `@hono/zod-openapi`), Dokploy versus Kamal, which TD-6 anti-scraping items ship. Ask.
