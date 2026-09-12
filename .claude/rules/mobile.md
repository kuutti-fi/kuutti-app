---
paths:
  - "apps/mobile/**"
---

# Mobile (Expo) rules

Stack: Expo SDK 57, React Native 0.86, React 19, TypeScript, dev client (`expo start --dev-client`, never Expo Go), web target for PR previews only. UI: React Native Reusables on NativeWind v4. Use the Expo plugin's skills and MCP for SDK specifics, and check the installed SDK version before following any doc.

## Auth and network

- Backend-driven auth: open the system browser at `api/auth/start`, receive a one-time code by deep link, exchange it for a session. The app never holds a client secret, an ID token, or PKCE state.
- Session and refresh tokens live in `expo-secure-store`, never AsyncStorage.
- API base URL comes from `Constants.expoConfig.hostUri` in dev and `EXPO_PUBLIC_API_URL` otherwise. `EXPO_PUBLIC_*` is public by definition; never put a secret there.
- No analytics or tracking SDK in the app. Research events are emitted server-side only.
- App Links and Universal Links files (`assetlinks.json`, `apple-app-site-association`) are served by the API, not bundled here.

## Images

- Upload only through the API. Pre-resize to 1600 px with `expo-image-manipulator` (which drops EXIF) before upload.
- Render with `expo-image`; `cacheKey` is `photoId/variant`, never the signed URL. Use the blurhash from the profile JSON as the placeholder.
- Variants: thumb in lists, card on open, full only on zoom. Never prefetch beyond the current round; prefetch counts as exposure.
- Photo and chat screens get `FLAG_SECURE` on Android and screenshot detection on iOS (M4).

## UI

- Tokens as CSS variables; light and dark defined together; `userInterfaceStyle: automatic`. Never hardcode a colour.
- The accessibility rules in `CLAUDE.md` apply to every component. Add `accessibilityLabel` and `accessibilityRole` in the same change that adds the touchable.
- Decisions are buttons with configurable placement (order, left or right thumb, one-handed). No swipe as primary input, no rapid repeat.
- Every candidate card shows its reason label: matches all filters, liked you, seen before, or included because you relaxed X.
- Candidate lists are bounded to the round. No pagination, no "load more", no on-demand fetch of the next profile.
- Glyph sets never imitate console vendors' trademarked shapes or names.

## Notifications

- One push per day at round time. In-conversation message push is the only exception and is rate-limited. Payloads never carry message text.

## i18n

- Every user-facing string is a typed `t()` key from `packages/i18n`. No inline strings, no concatenation with inflected values; `in {pond}` is banned.
- ICU plurals; Intl for dates and numbers; the `en-XA` pseudo-locale in dev builds to catch overflow.

## Testing and builds

- Component tests use jest-expo, not Vitest. Test that accessibility props exist.
- EAS Update uses `runtimeVersion: { policy: "fingerprint" }`; rebuild natively only when the fingerprint changes. Channels `staging` and `production` follow the deploy promotion.
- The web preview runs only against the mock IdP and seed data. Nothing in the web target may become a product web surface.
