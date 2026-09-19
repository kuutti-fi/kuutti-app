# Design evidence

Dated checks of the design tokens (`apps/mobile/src/theme/tokens.css`, TD-9). Contrast is checked on every change by `pnpm --filter mobile check:contrast`; what is here was done once by hand and is repeated when the palette changes.

## Deuteranopia, 2026-09-19 (#12)

`palette-deuteranopia-2026-09-19.png`: every token of the four sets as defined (left of each pair) and under simulated deuteranopia (right; Machado, Oliveira and Fernandes 2009, severity 1.0, applied in linear RGB).

- Every text pair of `src/theme/contrast.ts` still meets its threshold on the simulated colours, in all four sets. Tightest: `--destructive` on `--card` in light, 5.13:1 (4.5 required); `--muted-foreground` on `--muted` in dark, 6.86:1.
- `--primary` and `--destructive` keep different hues (blue against olive) but land at almost the same lightness: 1.0:1 to 1.4:1 between them in every set. They can be told apart side by side, not reliably on their own. That is the accessibility rule in practice: a destructive action is never marked by colour alone, it differs in label, shape and position, and pass and like are never a red and green pair.
- Nothing in the palette relies on a red and green distinction.
