import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  exceptions: [] as unknown[],
  tags: {} as Record<string, string>,
}));
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  flush: vi.fn(async () => true),
  captureException: vi.fn((error: unknown) => {
    captured.exceptions.push(error);
    return "event-id";
  }),
  withScope: vi.fn((fn: (scope: { setTag(k: string, v: string): void }) => void) =>
    fn({
      setTag(k, v) {
        captured.tags[k] = v;
      },
    }),
  ),
}));

import { sentryOptions, sentryReporter, stripRequestData } from "./sentry.ts";

const base = { APP_ENV: "staging" as const, APP_VERSION: "1.2.3", GIT_COMMIT: "abc1234" };

describe("sentry options", () => {
  it("is off without a DSN and on with one, never with PII or tracing", () => {
    expect(sentryOptions({ ...base, SENTRY_DSN: undefined }).enabled).toBe(false);
    const on = sentryOptions({ ...base, SENTRY_DSN: "https://k@o1.ingest.de.sentry.io/2" });
    expect(on.enabled).toBe(true);
    expect(on.environment).toBe("staging");
    expect(on.release).toBe("kuutti-api@1.2.3+abc1234");
    expect(on.sendDefaultPii).toBe(false);
    expect(on.sampleRate).toBe(1);
    expect(on.tracesSampleRate).toBe(0);
    expect(on.beforeSend).toBe(stripRequestData);
  });

  it("strips request data, user details and breadcrumb payloads from every event", () => {
    const event = stripRequestData({
      type: undefined,
      request: {
        url: "https://api.example/x?hetu=010190-123A",
        headers: { cookie: "session=abc" },
        data: { message: "private words" },
      },
      user: { id: "acc-1", email: "a@b.fi", ip_address: "10.0.0.1" },
      breadcrumbs: [{ category: "http", data: { url: "https://x/?email=a@b.fi" } }],
    });
    expect(event.request).toBeUndefined();
    expect(event.user).toEqual({ id: "acc-1" });
    expect(event.breadcrumbs?.[0]?.data).toBeUndefined();
    expect(JSON.stringify(event)).not.toMatch(/010190-123A|a@b\.fi|private words|session=abc/);
  });

  it("reports an exception with the request id and route as tags", () => {
    const error = new Error("boom");
    sentryReporter()(error, { requestId: "req-1", route: "/health" });
    expect(captured.exceptions).toEqual([error]);
    expect(captured.tags).toEqual({ requestId: "req-1", route: "/health" });
  });
});
