import { cors } from "hono/cors";

/**
 * Browser origins are refused by default (non-negotiable rule 8: no web surface
 * for the product). The allowlist exists for the admin SPA, the waitlist site
 * and per-PR previews, each of which names exactly its own origin. In local
 * development the Metro web target on 8081 is allowed so the web preview can
 * reach the API. Configuration moves to the zod-validated env in #3.
 */
export function allowedOrigins(): ReadonlySet<string> {
  const fromEnv = process.env.CORS_ALLOWED_ORIGINS;
  if (fromEnv !== undefined) {
    return new Set(
      fromEnv
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    );
  }
  return process.env.NODE_ENV === "production" ? new Set() : new Set(["http://localhost:8081"]);
}

export function corsAllowlist() {
  const allowed = allowedOrigins();
  return cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  });
}
