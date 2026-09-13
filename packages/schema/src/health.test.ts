import { describe, expect, it } from "vitest";
import { HealthResponse } from "./health.ts";

const base = {
  status: "ok",
  version: "0.0.0-dev",
  commit: "abc1234",
  builtAt: "2026-09-13T00:00:00.000Z",
  db: "ok",
  migrations: "current",
};

describe("HealthResponse", () => {
  it("accepts the shape the API returns", () => {
    expect(HealthResponse.safeParse(base).success).toBe(true);
  });

  it("accepts the degraded shape", () => {
    expect(
      HealthResponse.safeParse({ ...base, status: "degraded", db: "unreachable" }).success,
    ).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(HealthResponse.safeParse({ ...base, status: "fine" }).success).toBe(false);
  });
});
