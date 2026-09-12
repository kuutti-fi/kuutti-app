---
paths:
  - "apps/admin/**"
---

# Admin panel (Vite + React) rules

A static SPA built to S3 behind CloudFront on `admin.<domain>`; PR previews are a bucket prefix. It calls admin routes on the same Hono API. The component approach (Refine, or TanStack Table + shadcn) is open; do not mix both.

- Auth: Telia login on web, allowlist by `hetu_hmac`, roles moderator / admin / researcher checked server-side. Sessions 8 hours, no refresh.
- Launch screens: report queue (report, frozen conversation snapshot, both profiles by pseudonymous id, reporter history), photo review queue, actions warn / shadow-ban / suspend / ban with an appeal note, auto-shadow-ban threshold editor, `matching_config` editor.
- Every moderator action writes the immutable audit log (who, what, when, why). Photo views go through short-TTL signed URLs and are logged.
- Never auto-delete a photo, never expose a bulk export, never show `hetu_hmac` or `research_id` in the UI.
- English only. The accessibility rules in `CLAUDE.md` apply: keyboard navigation, labels, contrast.
- Same zod contracts from `packages/schema`; no hand-rolled fetch types.
