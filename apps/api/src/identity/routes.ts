import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  AuthCallbackQuery,
  AuthExchangeRequest,
  AuthExchangeResponse,
  AuthStartQuery,
  ErrorResponse,
} from "@kuutti/schema";
import type { Deps } from "../app.ts";
import type { AppEnv } from "../lib/env.ts";
import { AppError } from "../lib/errors.ts";
import { hmacKeyFromHex } from "./hetu.ts";
import { completeLogin, exchangeCode, type LoginDeps, startLogin } from "./login.ts";

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponse } },
});

const startRoute = createRoute({
  method: "get",
  path: "/auth/start",
  summary: "Begin a bank login",
  description:
    "Opened in the system browser by the app. Redirects to the identification broker's bank chooser; the person comes back through /auth/callback and the app receives a one-time code by deep link.",
  request: { query: AuthStartQuery },
  responses: {
    302: { description: "Redirect to the broker." },
    400: errorContent("Validation failed."),
    503: errorContent("No identification broker is configured."),
  },
});

const callbackRoute = createRoute({
  method: "get",
  path: "/auth/callback",
  summary: "The broker's return",
  description:
    "The registered redirect URI. Exchanges the code with the broker, derives the identity, applies the re-registration rule and redirects to the app's deep link with a one-time code. Never called by the app itself.",
  request: { query: AuthCallbackQuery },
  responses: {
    302: { description: "Redirect to kuutti://auth?code=… ." },
    400: errorContent("Unknown or expired login attempt (auth_state_mismatch)."),
    403: errorContent("Refused: auth_under_18, auth_banned, auth_suspended or auth_cooldown."),
    502: errorContent("The broker did not complete the login (auth_provider_error)."),
    503: errorContent("No identification broker is configured."),
  },
});

const exchangeRoute = createRoute({
  method: "post",
  path: "/auth/exchange",
  summary: "Exchange the one-time code",
  description:
    "Single use, within 60 seconds of the callback. Sessions (#35) will answer with tokens.",
  request: { body: { content: { "application/json": { schema: AuthExchangeRequest } } } },
  responses: {
    200: {
      description: "The account this login resolved to.",
      content: { "application/json": { schema: AuthExchangeResponse } },
    },
    400: errorContent("Validation failed."),
    401: errorContent("Unknown, used or expired code (auth_code_used)."),
  },
});

export function authRoutes(deps: Deps) {
  const app = new OpenAPIHono<AppEnv>();
  const hmacKey = deps.config.HETU_HMAC_KEY ? hmacKeyFromHex(deps.config.HETU_HMAC_KEY) : null;

  const loginDeps = (): LoginDeps => {
    if (!deps.broker || !hmacKey) {
      throw new AppError(503, "auth_provider_error", "Bank identification is not configured here");
    }
    return { db: deps.db, broker: deps.broker, hmacKey, now: () => new Date() };
  };

  app.openapi(startRoute, async (c) => {
    const query = c.req.valid("query");
    const url = await startLogin(loginDeps(), {
      platform: query.platform,
      locale: query.locale ?? c.get("locale"),
    });
    return c.redirect(url.toString(), 302);
  });

  app.openapi(callbackRoute, async (c) => {
    const query = c.req.valid("query");
    const target = await completeLogin(loginDeps(), {
      callbackUrl: new URL(c.req.url),
      query,
    });
    return c.redirect(target.toString(), 302);
  });

  app.openapi(exchangeRoute, async (c) => {
    const { code } = c.req.valid("json");
    const answer = await exchangeCode({ db: deps.db, now: () => new Date() }, code);
    return c.json(answer, 200);
  });

  return app;
}
