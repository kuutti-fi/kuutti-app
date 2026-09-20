<!-- What changes and why. Link the issue: "Closes #n". -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`, DCO).
- [ ] The change cites the TD or ADR it follows, or adds an ADR (identity, uploads, event flow, data retention, infrastructure).
- [ ] Security surfaces touched (Telia OIDC exchange, hetu HMAC, session tokens, signed URLs, workflows, infrastructure)? If yes, the `security-reviewer` agent or a second person has read the diff against `docs/security-checklist.md`.
- [ ] User-facing text goes through `t()` with keys in `packages/i18n/messages.yaml`; `pnpm i18n:build` output is committed.
- [ ] Every new touchable has `accessibilityLabel` and `accessibilityRole`, is at least 44 pt, and the screen holds at the largest font size.
- [ ] New dependency: maintained, pinned, any install script named here, licence inside `scripts/license-policy.json`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass locally.
