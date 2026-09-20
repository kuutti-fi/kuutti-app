import { describe, expect, it } from "vitest";
import { HealthResponse } from "./health.ts";

const base = {
  status: "ok",
  version: "0.0.0-dev",
  commit: "abc1234",
  builtAt: "2026-09-13T00:00:00.000Z",
  source: "https://github.com/kuutti-fi/kuutti-app",
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

  it("requires the source offer, and only as an https address a client may link", () => {
    const { source: _source, ...withoutSource } = base;
    expect(HealthResponse.safeParse(withoutSource).success).toBe(false);
    for (const source of ["http://example.com/fork", "javascript:alert(1)", "not a url"]) {
      expect(HealthResponse.safeParse({ ...base, source }).success).toBe(false);
    }
  });

  it("rejects an unknown status", () => {
    expect(HealthResponse.safeParse({ ...base, status: "fine" }).success).toBe(false);
  });
});
