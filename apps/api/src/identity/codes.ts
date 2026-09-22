import { createHash, randomBytes } from "node:crypto";

/** How long the app has to exchange the code the deep link carried. */
export const ONE_TIME_CODE_TTL_MS = 60_000;
/** How long the person has from /auth/start to the callback. */
export const AUTH_REQUEST_TTL_MS = 10 * 60_000;

/** 32 random bytes, base64url: the code goes to the app, only its hash is stored. */
export function newOneTimeCode(): { code: string; hash: string } {
  const code = randomBytes(32).toString("base64url");
  return { code, hash: hashOneTimeCode(code) };
}

export function hashOneTimeCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Deep link the browser is sent to after the bank; the app's scheme is `kuutti`. */
export function appReturnUrl(code: string): string {
  return `kuutti://auth?code=${encodeURIComponent(code)}`;
}
