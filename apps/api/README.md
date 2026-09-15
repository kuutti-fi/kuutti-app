# @kuutti/api

Hono on Node. Vertical slices under `src/<slice>/`, horizontal code under `src/lib/`, nightly jobs under `src/jobs/`. Rules: `.claude/rules/api.md` and `.claude/rules/layout.md`.

- `pnpm dev` runs `tsx watch` on port 3000.
- `pnpm build` bundles to `dist/index.js`; `pnpm start` runs it.
- `pnpm test` runs Vitest. `pnpm typecheck` runs tsc.
- `APP_ENV=preview` with `PR_NUMBER=<n>` (set by `preview.yml`, #9) makes the process create `kuutti_pr_<n>` on the staging instance as the `kuutti_preview` role, migrate and seed it, and serve from it; it reads `/kuutti/staging/*` and throttles at 30 requests a minute.
