# @kuutti/mobile

Expo SDK 57, dev client, Expo Router, web target for previews. `app/` holds routes only; features live under `src/features/<slice>/`, horizontal code under `src/lib/`. Rules: `.claude/rules/mobile.md`, `.claude/rules/layout.md`.

- `pnpm start` opens the dev client (`expo start --dev-client`). Expo Go is not supported.
- `pnpm web` runs the web target against the local API.
- `pnpm test` runs jest-expo. `pnpm typecheck` runs tsc.
