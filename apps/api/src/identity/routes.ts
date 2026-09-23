import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  AuthCallbackQuery,
  AuthExchangeRequest,
  AuthExchangeResponse,
  AuthRefreshRequest,
  AuthStartQuery,
  ErrorResponse,
  SessionResponse,
  SessionTokens,
} from "@kuutti/schema";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "../app.ts";
import { callerOf } from "../lib/auth-middleware.ts";
import type { AppEnv } from "../lib/env.ts";
import { AppError } from "../lib/errors.ts";
import { hmacKeyFromHex } from "./hetu.ts";
import { completeLogin, exchangeCode, type LoginDeps, startLogin } from "./login.ts";
import {
  describeSession,
  endAllSessions,
  endSession,
  issueSession,
  refreshSession,
  type SessionDeps,
} from "./sessions.ts";

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponse } },
});
const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const bearer = { security: [{ session: [] }] };

/** What the device is called in its own list: the platform plus a bounded user agent. */
const USER_AGENT_MAX = 200;

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
  summary: "Exchange the one-time code for a session",
  description:
    "Single use, within 60 seconds of the callback. Answers with this device's access and refresh tokens; the app keeps both in secure storage.",
  request: { body: json(AuthExchangeRequest) },
  responses: {
    200: { description: "The device's session.", ...json(AuthExchangeResponse) },
    400: errorContent("Validation failed."),
    401: errorContent("Unknown, used or expired code (auth_code_used)."),
  },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/auth/refresh",
  summary: "Rotate the session's tokens",
  description:
    "Presents the refresh token, receives a new pair; the old refresh token is retired. Presenting a retired token ends the device's session (session_revoked): sign in through the bank again.",
  request: { body: json(AuthRefreshRequest) },
  responses: {
    200: { description: "The new pair.", ...json(SessionTokens) },
    400: errorContent("Validation failed."),
    401: errorContent("Retired, revoked, expired or unknown refresh token (session_revoked)."),
  },
});

const sessionRoute = createRoute({
  method: "get",
  path: "/auth/session",
  summary: "This device's session",
  ...bearer,
  responses: {
    200: { description: "The caller's own session.", ...json(SessionResponse) },
    401: errorContent("unauthenticated, session_expired or session_revoked."),
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/auth/logout",
  summary: "Sign out this device",
  ...bearer,
  responses: {
    204: { description: "The session is ended; both tokens stop working." },
    401: errorContent("unauthenticated, session_expired or session_revoked."),
  },
});

const logoutAllRoute = createRoute({
  method: "post",
  path: "/auth/logout-all",
  summary: "Sign out every device",
  description: "Recovery for a lost phone: every session of the account ends, including this one.",
  ...bearer,
  responses: {
    204: { description: "Every session of the account is ended." },
    401: errorContent("unauthenticated, session_expired or session_revoked."),
  },
});

export function authRoutes(deps: Deps, requireSession: MiddlewareHandler<AppEnv>) {
  const app = new OpenAPIHono<AppEnv>();
  const hmacKey = deps.config.HETU_HMAC_KEY ? hmacKeyFromHex(deps.config.HETU_HMAC_KEY) : null;
  const now = () => new Date();
  const sessionDeps: SessionDeps = { db: deps.db, now };

  const loginDeps = (): LoginDeps => {
    if (!deps.broker || !hmacKey) {
      throw new AppError(503, "auth_provider_error", "Bank identification is not configured here");
    }
    return { db: deps.db, broker: deps.broker, hmacKey, now };
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
    const login = await exchangeCode(sessionDeps, code);
    const tokens = await issueSession(sessionDeps, {
      accountId: login.accountId,
      platform: login.platform,
      userAgent: c.req.header("user-agent")?.slice(0, USER_AGENT_MAX) ?? null,
    });
    return c.json({ ...tokens, outcome: login.outcome }, 200);
  });

  app.openapi(refreshRoute, async (c) => {
    const { refreshToken } = c.req.valid("json");
    return c.json(await refreshSession(sessionDeps, refreshToken), 200);
  });

  // The guard is registered on the path before the handler (app.test.ts
  // reads it from the route table); a route without it is a public route.
  for (const route of [sessionRoute, logoutRoute, logoutAllRoute]) {
    app.use(route.getRoutingPath(), requireSession);
  }

  app.openapi(sessionRoute, async (c) => {
    return c.json(await describeSession(sessionDeps, callerOf(c)), 200);
  });

  app.openapi(logoutRoute, async (c) => {
    await endSession(sessionDeps, callerOf(c).sessionId);
    return c.body(null, 204);
  });

  app.openapi(logoutAllRoute, async (c) => {
    await endAllSessions(sessionDeps, callerOf(c).accountId);
    return c.body(null, 204);
  });

  return app;
}
