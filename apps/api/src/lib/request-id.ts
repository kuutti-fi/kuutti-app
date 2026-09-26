import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.ts";

/**
 * The request id is the server's (#52, audit F26): a client-sent X-Request-Id
 * is neither used nor echoed, so nobody can make two log lines look like one
 * request or pick the id a support case is looked up by. The id goes back in
 * the response header and into every log line of the request; behind
 * CloudFront the request logger adds the distribution's own id next to it.
 */
export function serverRequestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = randomUUID();
    c.set("requestId", id);
    c.header("X-Request-Id", id);
    await next();
  };
}

/** CloudFront's request id (X-Amz-Cf-Id), only when it looks like one; a correlation field, never logic. */
export function cloudFrontRequestId(header: string | undefined): string | undefined {
  return header && /^[A-Za-z0-9_=-]{1,64}$/.test(header) ? header : undefined;
}
