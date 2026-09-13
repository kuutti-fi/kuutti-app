import { HealthResponse } from "@kuutti/schema";
import { describe, expect, it } from "vitest";
import { app } from "../app.ts";

describe("GET /health", () => {
  it("returns the build identity in the contract shape", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body.status).toBe("ok");
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("allows an allowlisted origin only", async () => {
    const res = await app.request("/health", { headers: { Origin: "http://localhost:8081" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8081");
  });

  it("sends no CORS headers to a browser origin", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com", "Access-Control-Request-Method": "GET" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
