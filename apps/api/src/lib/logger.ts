import type { MiddlewareHandler } from "hono";
import pino, { type Logger } from "pino";

export type { Logger };

/**
 * Fields that must never reach a log line: the personal identity code, message
 * text, email, credentials (CLAUDE.md security defaults, rule 5). Top level and
 * one level nested; the PII-in-logs test (#11) is the backstop.
 */
export const REDACTED_PATHS = [
  "hetu",
  "personal_identity_code",
  "email",
  "message",
  "text",
  "password",
  "authorization",
  "cookie",
  "*.hetu",
  "*.personal_identity_code",
  "*.email",
  "*.message",
  "*.text",
  "*.password",
  "*.authorization",
  "*.cookie",
];

export type LogDestination = { write(line: string): void };

export type LoggerOptions = {
  level: string;
  pretty: boolean;
  destination?: LogDestination;
};

export async function createLogger(options: LoggerOptions): Promise<Logger> {
  const base = {
    level: options.level,
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  };
  if (options.pretty) {
    // Development only. pino-pretty is external to the production bundle and
    // never installed in the runtime image.
    const { default: pretty } = await import("pino-pretty");
    return pino(base, pretty({ colorize: true, translateTime: "HH:MM:ss" }));
  }
  return pino(base, options.destination ?? pino.destination(1));
}

/** Structured request log with the fields the checklist allows: ids, route, status, timing. */
export function requestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    logger.info(
      {
        requestId: c.get("requestId"),
        method: c.req.method,
        route: c.req.routePath,
        status: c.res.status,
        durationMs: Math.round((performance.now() - started) * 10) / 10,
      },
      "request",
    );
  };
}
