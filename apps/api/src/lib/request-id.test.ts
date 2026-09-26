import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "./env.ts";
import { cloudFrontRequestId, serverRequestId } from "./request-id.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("request id (audit F26)", () => {
  it("is the server's: a client-sent X-Request-Id is neither used nor echoed", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", serverRequestId());
    app.get("/", (c) => c.text(c.get("requestId")));
    const response = await app.request("/", {
      headers: { "x-request-id": "chosen-by-the-client" },
    });
    const issued = response.headers.get("x-request-id");
    expect(issued).toMatch(UUID);
    expect(await response.text()).toBe(issued);
    const again = await app.request("/", { headers: { "x-request-id": "chosen-by-the-client" } });
    expect(again.headers.get("x-request-id")).not.toBe(issued);
  });

  it("keeps CloudFront's id for the log only when it looks like one", () => {
    expect(cloudFrontRequestId("abc_DEF-123==")).toBe("abc_DEF-123==");
    expect(cloudFrontRequestId("has spaces")).toBeUndefined();
    expect(cloudFrontRequestId("x".repeat(65))).toBeUndefined();
    expect(cloudFrontRequestId(undefined)).toBeUndefined();
  });
});
