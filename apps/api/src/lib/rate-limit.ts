import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { envelope } from "./errors.ts";

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  skip?: (path: string) => boolean;
  now?: () => number;
};

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window limiter, in process (TD-3: no Redis; one box). Keyed by the
 * client address: the first X-Forwarded-For hop behind CloudFront or Traefik,
 * the socket address otherwise. A request whose address cannot be determined
 * shares one bucket rather than bypassing the limit, which is the fail-closed
 * choice. Velocity rules for scraping (TD-6) are separate and slice-level.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? Date.now;

  return async (c, next) => {
    if (options.skip?.(c.req.path)) return next();
    const at = now();
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= at) buckets.delete(key);
    }
    const key = clientKey(c);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= at) {
      bucket = { count: 0, resetAt: at + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    c.header("RateLimit-Limit", String(options.limit));
    c.header("RateLimit-Remaining", String(Math.max(0, options.limit - bucket.count)));
    if (bucket.count > options.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - at) / 1000));
      c.header("Retry-After", String(retryAfter));
      const requestId: unknown = c.get("requestId");
      return c.json(
        envelope(
          "rate_limited",
          "Too many requests",
          typeof requestId === "string" ? requestId : "unknown",
        ),
        429,
      );
    }
    return next();
  };
}

function clientKey(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}
