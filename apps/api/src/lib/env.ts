import type { Locale, TFunction } from "@kuutti/i18n";
import type { RequestIdVariables } from "hono/request-id";

/**
 * Hono environment shared by every route and middleware: the request id, and
 * the request's locale with a t() fixed to it (#13).
 */
export type AppEnv = { Variables: RequestIdVariables & { locale: Locale; t: TFunction } };
