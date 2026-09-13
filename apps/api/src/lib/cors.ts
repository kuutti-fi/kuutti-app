import { cors } from "hono/cors";

/**
 * Browser origins are refused by default (rule 8). The allowlist names exactly
 * the admin SPA, the waitlist site, and a preview's own origin; development
 * allows the Metro web target. Values come from the validated config.
 */
export function corsAllowlist(allowed: ReadonlySet<string>) {
  return cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  });
}
