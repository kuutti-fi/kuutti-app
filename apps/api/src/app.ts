import { OpenAPIHono } from "@hono/zod-openapi";
import type { Queryable } from "@kuutti/db";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { healthRoutes } from "./health/index.ts";
import type { Config } from "./lib/config.ts";
import { corsAllowlist } from "./lib/cors.ts";
import type { AppEnv } from "./lib/env.ts";
import { envelope, notFound, onError, validationHook } from "./lib/errors.ts";
import { type Logger, requestLogger } from "./lib/logger.ts";
import { openApiDocument } from "./lib/openapi.ts";
import { rateLimit } from "./lib/rate-limit.ts";

export type { AppEnv };

/** Everything a request handler may reach. Injected, so tests hand in a transaction. */
export type Deps = {
  config: Config;
  logger: Logger;
  db: Queryable;
};

const UNLIMITED_PATHS = new Set(["/health", "/openapi.json"]);

export function createApp(deps: Deps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook<AppEnv>(deps.logger) });

  // Order matters: id first so every later line carries it, logging next so
  // even rejected requests are logged, then the protections, then routes.
  app.use("*", requestId());
  app.use("*", requestLogger(deps.logger));
  app.use("*", secureHeaders());
  // No environment of this API is a web surface (rule 8); previews have public
  // URLs that a crawler may still find (#9).
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow");
  });
  app.use("*", corsAllowlist(deps.config.corsAllowedOrigins));
  app.use(
    "*",
    bodyLimit({
      maxSize: deps.config.BODY_LIMIT_BYTES,
      onError: (c) =>
        c.json(envelope("payload_too_large", "Request body too large", c.get("requestId")), 413),
    }),
  );
  app.use(
    "*",
    rateLimit({
      limit: deps.config.RATE_LIMIT_PER_MINUTE,
      windowMs: 60_000,
      skip: (path) => UNLIMITED_PATHS.has(path),
    }),
  );

  app.onError(onError<AppEnv>(deps.logger));
  app.notFound(notFound<AppEnv>());

  app.route("/", healthRoutes(deps));

  if (deps.config.APP_ENV !== "production") {
    app.doc("/openapi.json", openApiDocument(deps.config.APP_VERSION));
  }

  return app;
}

export type App = ReturnType<typeof createApp>;
