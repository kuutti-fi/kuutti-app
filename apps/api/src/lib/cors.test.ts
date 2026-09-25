import { describe, expect } from "vitest";
import { test } from "../test/harness.ts";

// Browser origins are refused unless allowlisted (rule 8); the admin panel's
// preflight (bearer token, JSON body) must pass for an allowlisted one (#49).
describe("CORS allowlist", () => {
  test("an allowlisted origin's preflight admits Authorization and Content-Type", async ({
    ctx,
  }) => {
    const res = await ctx.app.request("/admin/photos/queue", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowed).toContain("authorization");
    expect(allowed).toContain("content-type");
  });

  test("an unknown origin gets no CORS headers at all", async ({ ctx }) => {
    const res = await ctx.app.request("/admin/photos/queue", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
