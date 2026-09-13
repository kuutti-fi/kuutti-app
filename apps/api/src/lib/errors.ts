import type { Hook } from "@hono/zod-openapi";
import type { ErrorResponse } from "@kuutti/schema";
import type { Context, Env, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "./logger.ts";

/** A failure the route chose to signal. Detail is logged, never returned. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function envelope(code: string, message: string, requestId: string): ErrorResponse {
  return { error: { code, message, requestId } };
}

function requestIdOf<E extends Env>(c: Context<E, string>): string {
  const id: unknown = c.get("requestId");
  return typeof id === "string" && id.length > 0 ? id : "unknown";
}

export function onError<E extends Env>(logger: Logger): ErrorHandler<E> {
  return (err, c) => {
    const requestId = requestIdOf(c);
    if (err instanceof AppError) {
      logger.warn({ requestId, code: err.code, detail: err.detail }, err.message);
      return c.json(envelope(err.code, err.message, requestId), err.status);
    }
    if (err instanceof HTTPException) {
      const status = err.status as ContentfulStatusCode;
      const code =
        status === 413 ? "payload_too_large" : status === 401 ? "unauthenticated" : "http_error";
      logger.warn({ requestId, status }, err.message);
      return c.json(envelope(code, err.message || "Request failed", requestId), status);
    }
    logger.error({ requestId, err }, "unhandled error");
    return c.json(envelope("internal_error", "Internal error", requestId), 500);
  };
}

export function notFound<E extends Env>(): NotFoundHandler<E> {
  return (c) => c.json(envelope("not_found", "Not found", requestIdOf(c)), 404);
}

/**
 * Runs after every contract validation. A failed body, query, or param never
 * reaches a handler: 400 in the envelope, the zod issues in the log line that
 * shares the requestId.
 */
export function validationHook<E extends Env>(logger: Logger): Hook<unknown, E, string, unknown> {
  return (result, c) => {
    if (!result.success) {
      logger.warn(
        { requestId: requestIdOf(c), route: c.req.routePath, issues: result.error.issues },
        "request validation failed",
      );
      return c.json(
        envelope("validation_failed", "Request validation failed", requestIdOf(c)),
        400,
      );
    }
    return undefined;
  };
}
