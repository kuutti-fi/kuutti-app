import {
  createI18n,
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
  type MessageKey,
  parseAcceptLanguage,
  resolveLocale,
  type TFunction,
  typedT,
} from "@kuutti/i18n";
import type { Context, Env, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "./env.ts";

// One instance per process; each request gets a t() fixed to its own locale,
// so concurrent requests never see each other's language.
const i18n = createI18n({ locale: DEFAULT_LOCALE });
const fallbackT = typedT(i18n, DEFAULT_LOCALE);

// A header that drives logic passes a schema (rules/api.md). The catalogue list
// is the enum, so nothing from the request can become a locale, a header value
// or a lookup key that is not one of ours.
const RequestLocale = z.enum(LOCALES);

/**
 * Resolves the request's locale and hands handlers `c.get("t")`. M1 reads
 * Accept-Language; from M2 an authenticated request uses the account's stored
 * locale instead (TD-17), which is also what push and receipts will use.
 * Responses vary by the header, and say which language they carry.
 */
export function requestLocale(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const locale = RequestLocale.parse(
      resolveLocale(parseAcceptLanguage(c.req.header("accept-language"))),
    );
    c.set("locale", locale);
    c.set("t", typedT(i18n, locale));
    await next();
    c.header("Content-Language", locale);
    c.header("Vary", "Accept-Language", { append: true });
  };
}

/** The request's t(), or English where the locale middleware has not run (a bare test app). */
export function tOf<E extends Env>(c: Context<E, string>): TFunction {
  const t: unknown = c.get("t" as never);
  return typeof t === "function" ? (t as TFunction) : fallbackT;
}

export function localeOf<E extends Env>(c: Context<E, string>): Locale {
  const locale: unknown = c.get("locale" as never);
  return typeof locale === "string" ? (locale as Locale) : DEFAULT_LOCALE;
}

/**
 * Error codes whose user-facing message lives in messages.yaml. The code stays
 * the stable, machine-readable part of the envelope; the message is for people
 * and follows the request's language.
 */
export const ERROR_MESSAGE_KEYS = {
  validation_failed: "errors.validation_failed",
  not_found: "errors.not_found",
  unauthenticated: "errors.unauthenticated",
  payload_too_large: "errors.payload_too_large",
  http_error: "errors.http_error",
  internal_error: "errors.internal_error",
  auth_state_mismatch: "errors.auth_state_mismatch",
  auth_code_used: "errors.auth_code_used",
  auth_under_18: "errors.auth_under_18",
  auth_provider_error: "errors.auth_provider_error",
  auth_banned: "errors.auth_banned",
  auth_suspended: "errors.auth_suspended",
  auth_cooldown: "errors.auth_cooldown",
  auth_cancelled: "errors.auth_cancelled",
  session_expired: "errors.session_expired",
  session_revoked: "errors.session_revoked",
} as const satisfies Record<string, MessageKey>;

export type LocalisedErrorCode = keyof typeof ERROR_MESSAGE_KEYS;

export const isLocalisedErrorCode = (code: string): code is LocalisedErrorCode =>
  Object.hasOwn(ERROR_MESSAGE_KEYS, code);
