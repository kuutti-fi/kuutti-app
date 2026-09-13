import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { captureLogger, test, testConfig } from "./test/harness.ts";

describe("OpenAPI document", () => {
  test("is served outside production and matches the committed file", async ({ ctx }) => {
    const res = await ctx.app.request("/openapi.json");
    expect(res.status).toBe(200);
    const served = (await res.json()) as {
      info: { version: string };
      paths: Record<string, unknown>;
    };
    const committed = JSON.parse(readFileSync(resolve("openapi.json"), "utf8")) as typeof served;
    // The committed file carries the package version; the served one the build version.
    expect({ ...served, info: { ...served.info, version: "x" } }).toEqual({
      ...committed,
      info: { ...committed.info, version: "x" },
    });
    expect(Object.keys(served.paths)).toContain("/health");
  });

  it("is absent in production", async () => {
    const { logger } = await captureLogger();
    const app = createApp({
      config: testConfig({ APP_ENV: "production", NODE_ENV: "production" }),
      logger,
      db: { query: async () => ({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] }) },
    });
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(404);
  });
});
