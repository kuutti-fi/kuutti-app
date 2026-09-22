import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createPool, migrate, seed } from "@kuutti/db";
import { createApp } from "./app.ts";
import {
  brokerOptionsFromConfig,
  DiscoveryError,
  discoverProvider,
  type IdentityBroker,
  isTeliaIssuer,
  OidcBroker,
} from "./identity/index.ts";
import { type Config, ConfigError, loadConfig } from "./lib/config.ts";
import { createLogger } from "./lib/logger.ts";
import { ensurePreviewDatabase } from "./lib/preview-database.ts";
import { flushSentry, initSentry, sentryReporter } from "./lib/sentry.ts";
import { buildInfo } from "./lib/version.ts";

async function main(): Promise<void> {
  let config: Config;
  try {
    config = await loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      const missing = error.missing.length > 0 ? error.missing.join(", ") : "none";
      console.error(
        `Configuration invalid. Missing keys: ${missing}\n  ${error.issues.join("\n  ")}`,
      );
      process.exit(1);
    }
    throw error;
  }

  const logger = await createLogger({
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === "development",
  });
  const info = buildInfo(config);

  // Error reporting is on exactly when a DSN is configured (#11).
  const reporting = initSentry(config);
  logger.info({ reporting, environment: config.APP_ENV }, "error reporting");
  if (reporting && config.SENTRY_SELF_TEST) {
    sentryReporter()(new Error("Sentry self-test: the API booted with SENTRY_SELF_TEST=true"), {
      requestId: "self-test",
    });
    logger.warn("Sentry self-test event sent; unset SENTRY_SELF_TEST and redeploy");
  }

  // Bank identification (#32): the broker's endpoints and keys come from its
  // discovery document, read here so that a wrong issuer, a broker outage or a
  // misconfigured environment is a failed boot on staging and production, and
  // a warning locally, never a failed login later. Telia offers private_key_jwt
  // only; a broker that does not is the wrong one.
  let broker: IdentityBroker | undefined;
  if (config.OIDC_ISSUER) {
    try {
      const provider = await discoverProvider(config.OIDC_ISSUER);
      const methods = provider.token_endpoint_auth_methods_supported ?? [];
      if (isTeliaIssuer(config.OIDC_ISSUER) && !methods.includes("private_key_jwt")) {
        throw new DiscoveryError(config.OIDC_ISSUER, "no private_key_jwt at the token endpoint");
      }
      logger.info(
        {
          issuer: provider.issuer,
          authorizationEndpoint: provider.authorization_endpoint,
          tokenEndpoint: provider.token_endpoint,
          jwksUri: provider.jwks_uri,
          acrValues: config.OIDC_ACR_VALUES ?? null,
          keys: {
            signing: config.TELIA_SIGNING_KEY !== undefined,
            encryption: config.TELIA_ENCRYPTION_KEY !== undefined,
          },
        },
        "bank identification",
      );
      const options = brokerOptionsFromConfig(config);
      if (options && config.HETU_HMAC_KEY) broker = await OidcBroker.create(options);
      else {
        // Half a configuration is a misnamed parameter, not a choice: a
        // deployed box must not boot healthy with the login answering 503.
        throw new Error(
          "bank identification off: OIDC_CLIENT_ID, OIDC_REDIRECT_URI or HETU_HMAC_KEY is not set",
        );
      }
    } catch (error) {
      if (config.APP_ENV === "development" || config.APP_ENV === "test") {
        logger.warn({ err: error }, "bank identification unavailable; is the mock IdP running?");
      } else {
        throw error;
      }
    }
  } else {
    logger.warn("bank identification off: OIDC_ISSUER is not set");
  }

  // A pull-request preview serves from its own kuutti_pr_<n> on the staging
  // instance, created here on first boot and dropped by preview-cleanup.yml
  // when the pull request closes (#9, TD-19). Never a copy of anything.
  if (config.preview) {
    const admin = createPool({
      connectionString: config.preview.adminDatabaseUrl,
      max: 1,
      applicationName: `kuutti-api-preview-${config.preview.prNumber}-setup`,
    });
    try {
      const state = await ensurePreviewDatabase(admin, config.preview.database);
      logger.info({ database: config.preview.database, state }, "preview database");
    } finally {
      await admin.end();
    }
  }

  const pool = createPool({
    connectionString: config.databaseUrl,
    max: config.DB_POOL_MAX,
    applicationName: `kuutti-api-${config.APP_ENV}`,
  });
  // An idle client the server drops (an RDS reboot or failover) is reported
  // here; pg-pool discards it and connects again on demand. Without a listener
  // the event is an uncaught exception and the process exits. Code and message
  // only: the error carries its client, connection parameters included.
  pool.on("error", (error: Error & { code?: string }) => {
    logger.error({ code: error.code, message: error.message }, "idle database client dropped");
  });

  // Migrations run before the server listens, under the advisory lock (rule 10).
  const migration = await migrate(pool, resolve(config.MIGRATIONS_DIR));
  logger.info(migration, "migrations");

  // Previews are always seeded (rules/db.md); the seed is idempotent, so every
  // boot converges on the same ponds and matching_config.
  if (config.preview) {
    const seeded = await seed(pool, `preview-pr-${config.preview.prNumber}`);
    logger.info(seeded, "seed");
  }

  const app = createApp({
    config,
    logger,
    db: pool,
    ...(reporting ? { report: sentryReporter() } : {}),
    ...(broker ? { broker } : {}),
  });
  const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (address) => {
    logger.info(
      { port: address.port, appEnv: config.APP_ENV, version: info.version, commit: info.commit },
      "API listening",
    );
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.fatal(
        { port: config.PORT },
        `port ${config.PORT} is already in use: another API is running, stop it or set PORT`,
      );
    } else {
      logger.fatal({ err: error }, "server error");
    }
    flushSentry()
      .then(() => pool.end())
      .finally(() => process.exit(1));
  });

  // Drain in-flight requests within 10 s so a redeploy drops nothing.
  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
