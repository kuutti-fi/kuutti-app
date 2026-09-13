import { describe, expect, it } from "vitest";
import { HealthResponse } from "./health.ts";

describe("HealthResponse", () => {
  it("accepts the shape the API returns", () => {
    const parsed = HealthResponse.safeParse({
      status: "ok",
      version: "0.0.0-dev",
      commit: "abc1234",
      builtAt: "2026-09-13T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const parsed = HealthResponse.safeParse({
      status: "degraded",
      version: "0.0.0-dev",
      commit: "abc1234",
      builtAt: "2026-09-13T00:00:00.000Z",
    });
    expect(parsed.success).toBe(false);
  });
});
