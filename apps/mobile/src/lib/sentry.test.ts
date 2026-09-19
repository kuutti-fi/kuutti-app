import { sentryEnvironment, sentryOptions, stripBreadcrumb } from "./sentry";

describe("sentry options", () => {
  const on = sentryOptions({ dsn: "https://k@o1.ingest.de.sentry.io/2", channel: "staging" });

  it("is off without a DSN", () => {
    expect(sentryOptions({ dsn: undefined, channel: null }).enabled).toBe(false);
    expect(sentryOptions({ dsn: "", channel: null }).enabled).toBe(false);
  });

  it("sends no PII, no traces, no replays, no screenshots, no sessions", () => {
    expect(on.enabled).toBe(true);
    expect(on.sendDefaultPii).toBe(false);
    expect(on.tracesSampleRate).toBe(0);
    expect(on.replaysSessionSampleRate).toBe(0);
    expect(on.replaysOnErrorSampleRate).toBe(0);
    expect(on.attachScreenshot).toBe(false);
    expect(on.attachViewHierarchy).toBe(false);
    expect(on.enableAutoSessionTracking).toBe(false);
  });

  it("drops the replay and feedback integrations from the defaults", () => {
    const filter = on.integrations;
    if (typeof filter !== "function") throw new Error("integrations must be a filter function");
    const names = filter([
      { name: "MobileReplay" },
      { name: "Feedback" },
      { name: "ReactNativeErrorHandlers" },
      { name: "NativeLinkedErrors" },
    ] as never[]).map((i) => i.name);
    expect(names).toEqual(["ReactNativeErrorHandlers", "NativeLinkedErrors"]);
  });

  it("maps the update channel to the environment", () => {
    expect(sentryEnvironment(null)).toBe("development");
    expect(sentryEnvironment("staging")).toBe("staging");
    expect(sentryEnvironment("pr-42")).toBe("preview");
    expect(sentryEnvironment("production")).toBe("production");
  });

  it("keeps route names and http status on breadcrumbs, nothing else", () => {
    const nav = stripBreadcrumb({
      category: "navigation",
      data: { from: "/pond", to: "/chat/[id]", params: { id: "chat-7", email: "a@b.fi" } },
    });
    expect(nav.data).toEqual({ from: "/pond", to: "/chat/[id]" });
    const http = stripBreadcrumb({
      category: "http",
      data: { method: "GET", status_code: 500, url: "https://api/x?hetu=010190-123A" },
    });
    expect(http.data).toEqual({ method: "GET", status_code: 500 });
    expect(JSON.stringify([nav, http])).not.toMatch(/a@b\.fi|010190-123A|chat-7/);
  });
});
