import { z } from "zod";

/**
 * The bank login (#33, docs/vendors/telia.md). The API is the OIDC client; the
 * app opens the system browser at /auth/start and receives a one-time code by
 * deep link, which it exchanges here. Nothing about the broker, the tokens or
 * the person's claims ever crosses this boundary (rules/mobile.md Auth).
 */

/** Where the browser is sent back to after the bank: the app's own scheme, or nothing yet for web. */
export const AuthPlatform = z.enum(["ios", "android"]).meta({ id: "AuthPlatform" });
export type AuthPlatform = z.infer<typeof AuthPlatform>;

export const AuthStartQuery = z
  .object({
    platform: AuthPlatform.meta({
      description: "The app that will receive the one-time code by deep link.",
    }),
    locale: z.enum(["fi", "sv", "en"]).optional().meta({
      description: "The language of the bank chooser (ui_locales); defaults to the request's.",
    }),
  })
  .meta({ id: "AuthStartQuery" });
export type AuthStartQuery = z.infer<typeof AuthStartQuery>;

export const AuthCallbackQuery = z
  .object({
    code: z.string().min(1).optional(),
    state: z.string().min(1),
    error: z.string().max(64).optional(),
    error_description: z.string().max(256).optional(),
  })
  .meta({ id: "AuthCallbackQuery" });
export type AuthCallbackQuery = z.infer<typeof AuthCallbackQuery>;

/** 32 random bytes as base64url: 43 characters, single use, 60 seconds. */
export const ONE_TIME_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const AuthExchangeRequest = z
  .object({
    code: z.string().regex(ONE_TIME_CODE_PATTERN).meta({
      description: "The one-time code the deep link carried.",
    }),
  })
  .meta({ id: "AuthExchangeRequest" });
export type AuthExchangeRequest = z.infer<typeof AuthExchangeRequest>;

/**
 * Until sessions land (#35) the exchange answers with the account the login
 * resolved to and what happened to it; #35 replaces the body with tokens.
 */
export const AuthExchangeResponse = z
  .object({
    accountId: z.uuid(),
    outcome: z.enum(["created", "resumed"]).meta({
      description:
        "created: a fresh account (first login or after a cooldown); resumed: the live account.",
    }),
  })
  .meta({ id: "AuthExchangeResponse" });
export type AuthExchangeResponse = z.infer<typeof AuthExchangeResponse>;

/** Stable error codes of the login (the envelope's `code`); messages come from messages.yaml. */
export const AUTH_ERROR_CODES = [
  "auth_state_mismatch",
  "auth_code_used",
  "auth_under_18",
  "auth_provider_error",
  "auth_banned",
  "auth_suspended",
  "auth_cooldown",
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
