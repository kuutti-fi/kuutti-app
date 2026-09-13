import { z } from "zod";
import { loadSsmParameters } from "./ssm.ts";

const AppEnv = z.enum(["development", "test", "preview", "staging", "production"]);

/**
 * Every configuration value the process reads, validated once at boot. A
 * missing or invalid key fails the start, never a request. Secrets come from
 * SSM in deployed environments (TD-19); locally the runtime reads .env through
 * node's --env-file, and tooling never touches that file (rule 9).
 */
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: AppEnv.default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  APP_VERSION: z.string().min(1).default("0.0.0-dev"),
  GIT_COMMIT: z.string().min(1).optional(),
  BUILT_AT: z.string().min(1).optional(),

  // Either the full URL, or the parts the SSM parameters carry (#7).
  DATABASE_URL: z.string().min(1).optional(),
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().min(1).optional(),
  DB_USER: z.string().min(1).optional(),
  DB_APP_PASSWORD: z.string().min(1).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  MIGRATIONS_DIR: z.string().min(1).default("../../packages/db/drizzle"),

  CORS_ALLOWED_ORIGINS: z.string().optional(),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  SSM_PARAMETER_PREFIX: z.string().min(1).optional(),
});

export type AppEnv = z.infer<typeof AppEnv>;

export type Config = z.infer<typeof Env> & {
  databaseUrl: string;
  corsAllowedOrigins: ReadonlySet<string>;
};

export class ConfigError extends Error {
  constructor(
    readonly missing: string[],
    readonly issues: string[],
  ) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
  }
}

export function parseConfig(raw: Record<string, string | undefined>): Config {
  const result = Env.safeParse(raw);
  if (!result.success) {
    const missing = result.error.issues
      .filter((i) => i.code === "invalid_type" && i.input === undefined)
      .map((i) => i.path.join("."));
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(missing, issues);
  }
  const env = result.data;
  const databaseUrl = env.DATABASE_URL ?? composeDatabaseUrl(env);
  if (!databaseUrl) {
    throw new ConfigError(
      ["DATABASE_URL"],
      ["DATABASE_URL: set it, or set DB_HOST, DB_NAME, DB_USER and DB_APP_PASSWORD"],
    );
  }
  return { ...env, databaseUrl, corsAllowedOrigins: allowedOrigins(env) };
}

function composeDatabaseUrl(env: z.infer<typeof Env>): string | undefined {
  if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !env.DB_APP_PASSWORD) return undefined;
  const user = encodeURIComponent(env.DB_USER);
  const password = encodeURIComponent(env.DB_APP_PASSWORD);
  return `postgres://${user}:${password}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}?sslmode=require`;
}

/**
 * Browser origins are refused unless named here (rule 8: no product web
 * surface). Development allows the Metro web target; deployed environments
 * name exactly the admin SPA, the waitlist site, or the preview's own origin.
 */
function allowedOrigins(env: z.infer<typeof Env>): ReadonlySet<string> {
  if (env.CORS_ALLOWED_ORIGINS !== undefined) {
    return new Set(
      env.CORS_ALLOWED_ORIGINS.split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    );
  }
  return env.APP_ENV === "development" || env.APP_ENV === "test"
    ? new Set(["http://localhost:8081"])
    : new Set();
}

/** SSM parameters fill in what the process environment does not set. */
export async function loadConfig(
  raw: Record<string, string | undefined> = process.env,
): Promise<Config> {
  const appEnv = raw.APP_ENV ?? "development";
  const deployed = appEnv === "staging" || appEnv === "production" || appEnv === "preview";
  const prefix = raw.SSM_PARAMETER_PREFIX ?? (deployed ? `/kuutti/${ssmEnv(appEnv)}/` : undefined);
  const fromSsm = prefix ? await loadSsmParameters(prefix) : {};
  return parseConfig({ ...fromSsm, ...raw });
}

/** Previews run on the staging instance and read staging parameters (#9). */
function ssmEnv(appEnv: string): string {
  return appEnv === "preview" ? "staging" : appEnv;
}
