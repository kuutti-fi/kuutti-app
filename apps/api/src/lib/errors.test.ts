import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "@kuutti/schema";
import { describe, expect, vi } from "vitest";
import { createApp } from "../app.ts";
import { captureLogger, test, testConfig } from "../test/harness.ts";
import { AppError } from "./errors.ts";

const echoRoute = createRoute({
  method: "post",
  path: "/echo",
  request: {
    body: { content: { "application/json": { schema: z.object({ name: z.string().min(1) }) } } },
  },
  responses: {
    200: {
      description: "echo",
      content: { "application/json": { schema: z.object({ name: z.string() }) } },
    },
  },
});

describe("error envelope", () => {
  test("invalid body: 400 in the envelope, detail only in the log with the same requestId", async ({
    ctx,
  }) => {
    ctx.app.openapi(echoRoute, (c) => c.json({ name: c.req.valid("json").name }, 200));

    const res = await ctx.app.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe("validation_failed");
    expect(JSON.stringify(body)).not.toContain("too_small");

    const line = ctx.logs().find((l) => l.msg === "request validation failed");
    expect(line?.requestId).toBe(body.error.requestId);
    expect(JSON.stringify(line?.issues)).toContain("too_small");
  });

  test("valid body reaches the handler", async ({ ctx }) => {
    ctx.app.openapi(echoRoute, (c) => c.json({ name: c.req.valid("json").name }, 200));
    const res = await ctx.app.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kuutti" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Kuutti" });
  });

  test("unknown path: 404 envelope", async ({ ctx }) => {
    const res = await ctx.app.request("/nope");
    expect(res.status).toBe(404);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe("not_found");
  });

  test("AppError: its status and code, detail logged not returned", async ({ ctx }) => {
    ctx.app.get("/teapot", () => {
      throw new AppError(418, "teapot", "I am a teapot", { secretDetail: "brew" });
    });
    const res = await ctx.app.request("/teapot");
    expect(res.status).toBe(418);
    const text = await res.text();
    expect(text).not.toContain("brew");
    expect(ErrorResponse.parse(JSON.parse(text)).error.code).toBe("teapot");
    expect(ctx.logs().some((l) => JSON.stringify(l.detail).includes("brew"))).toBe(true);
  });

  test("unexpected throw: 500 envelope, stack only in the log", async ({ ctx }) => {
    ctx.app.get("/boom", () => {
      throw new Error("kaboom with private detail");
    });
    const res = await ctx.app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("kaboom");
    expect(ErrorResponse.parse(JSON.parse(text)).error).toMatchObject({ code: "internal_error" });
    expect(ctx.logs().some((l) => l.msg === "unhandled error")).toBe(true);
  });

  // The hop between a route and Sentry (#11): the reporter that index.ts wires
  // in is called once, with the error itself and exactly what the envelope
  // lets the user quote back, the request id, plus the route pattern. Expected
  // errors (AppError, HTTPException) are never reported: they are answers.
  test("unexpected throw: reported once with the envelope's request id and the route", async ({
    ctx,
  }) => {
    const report = vi.fn();
    const { logger } = await captureLogger();
    const app = createApp({ config: testConfig(), logger, db: ctx.client, report });
    app.get("/boom/:id", () => {
      throw new Error("kaboom");
    });
    app.get("/teapot", () => {
      throw new AppError(418, "teapot", "I am a teapot");
    });

    const res = await app.request("/boom/7");
    expect(res.status).toBe(500);
    const body = ErrorResponse.parse(await res.json());
    expect(report).toHaveBeenCalledTimes(1);
    const [error, context] = report.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("kaboom");
    expect(context).toEqual({ requestId: body.error.requestId, route: "/boom/:id" });

    expect((await app.request("/teapot")).status).toBe(418);
    expect(report).toHaveBeenCalledTimes(1);
  });

  test("body over the limit: 413 envelope", async ({ ctx }) => {
    ctx.app.post("/big", async (c) => c.json({ size: (await c.req.text()).length }));
    const res = await ctx.app.request("/big", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(1_048_576 + 1),
    });
    expect(res.status).toBe(413);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe("payload_too_large");
  });
});
