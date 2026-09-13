# @kuutti/api

Hono on Node. Vertical slices under `src/<slice>/`, horizontal code under `src/lib/`, nightly jobs under `src/jobs/`. Rules: `.claude/rules/api.md` and `.claude/rules/layout.md`.

- `pnpm dev` runs `tsx watch` on port 3000.
- `pnpm build` bundles to `dist/index.js`; `pnpm start` runs it.
- `pnpm test` runs Vitest. `pnpm typecheck` runs tsc.
