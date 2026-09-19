import * as Sentry from "@sentry/node";
import type { Config } from "./config.ts";
import type { ErrorReporter } from "./errors.ts";

type SentryConfig = Pick<Config, "SENTRY_DSN" | "APP_ENV" | "APP_VERSION" | "GIT_COMMIT">;

/**
 * Error reporting only (TD-19, #11): every unhandled error, no tracing, and
 * nothing Sentry would attach by default that the logs may not carry either.
 * The DSN is public by design and comes from /kuutti/<env>/sentry-dsn; with
 * none set the SDK stays off, which is every local and test run.
 */
export function sentryOptions(config: SentryConfig): Sentry.NodeOptions {
  return {
    dsn: config.SENTRY_DSN,
    enabled: config.SENTRY_DSN !== undefined,
    environment: config.APP_ENV,
    release: `kuutti-api@${config.APP_VERSION}+${config.GIT_COMMIT ?? "unknown"}`,
    sendDefaultPii: false,
    sampleRate: 1,
    tracesSampleRate: 0,
    beforeSend: stripRequestData,
  };
}

/**
 * Request bodies, headers, cookies and query strings never leave the box: a
 * body can carry a message text or, during the bank callback, the hetu. What
 * remains identifies the request (requestId tag, route) and nothing else.
 */
export function stripRequestData<T extends Sentry.ErrorEvent>(event: T): T {
  delete event.request;
  if (event.user) {
    event.user = event.user.id === undefined ? undefined : { id: event.user.id };
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({ ...crumb, data: undefined }));
  }
  return event;
}

/** Initialised once at boot, after the configuration is known; true when reporting is on. */
export function initSentry(config: SentryConfig): boolean {
  const options = sentryOptions(config);
  if (!options.enabled) return false;
  Sentry.init(options);
  return true;
}

/** The reporter the error handler calls for 500s: exception plus the ids that find the log lines. */
export function sentryReporter(): ErrorReporter {
  return (error, { requestId, route }) => {
    Sentry.withScope((scope) => {
      scope.setTag("requestId", requestId);
      if (route) scope.setTag("route", route);
      Sentry.captureException(error);
    });
  };
}

/** Give queued events a moment to leave before the process exits. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  await Sentry.flush(timeoutMs).catch(() => undefined);
}
