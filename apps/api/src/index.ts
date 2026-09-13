import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createPool, migrate } from "@kuutti/db";
import { createApp } from "./app.ts";
import { type Config, ConfigError, loadConfig } from "./lib/config.ts";
import { createLogger } from "./lib/logger.ts";
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

  const pool = createPool({
    connectionString: config.databaseUrl,
    max: config.DB_POOL_MAX,
    applicationName: `kuutti-api-${config.APP_ENV}`,
  });

  // Migrations run before the server listens, under the advisory lock (rule 10).
  const migration = await migrate(pool, resolve(config.MIGRATIONS_DIR));
  logger.info(migration, "migrations");

  const app = createApp({ config, logger, db: pool });
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
    pool.end().finally(() => process.exit(1));
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
