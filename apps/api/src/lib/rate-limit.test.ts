import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit.ts";

function limitedApp(now: () => number) {
  const app = new Hono();
  app.use("*", requestId());
  app.use("*", rateLimit({ limit: 2, windowMs: 1_000, skip: (p) => p === "/free", now }));
  app.get("/", (c) => c.text("ok"));
  app.get("/free", (c) => c.text("ok"));
  return app;
}

describe("rate limit", () => {
  it("allows the limit, then answers 429 with Retry-After, then resets", async () => {
    let clock = 1_000;
    const app = limitedApp(() => clock);
    const from = { headers: { "x-forwarded-for": "203.0.113.7" } };
    expect((await app.request("/", from)).status).toBe(200);
    expect((await app.request("/", from)).status).toBe(200);
    const blocked = await app.request("/", from);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    clock += 1_001;
    expect((await app.request("/", from)).status).toBe(200);
  });

  it("keys on the first forwarded hop", async () => {
    const app = limitedApp(() => 1_000);
    const a = { headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" } };
    const b = { headers: { "x-forwarded-for": "198.51.100.2, 10.0.0.1" } };
    await app.request("/", a);
    await app.request("/", a);
    expect((await app.request("/", a)).status).toBe(429);
    expect((await app.request("/", b)).status).toBe(200);
  });

  it("skips exempt paths", async () => {
    const app = limitedApp(() => 1_000);
    for (let i = 0; i < 5; i += 1) expect((await app.request("/free")).status).toBe(200);
  });
});
