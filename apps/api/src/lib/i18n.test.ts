import { ErrorResponse } from "@kuutti/schema";
import { describe, expect } from "vitest";
import { createApp } from "../app.ts";
import { captureLogger, test, testConfig } from "../test/harness.ts";
import { AppError } from "./errors.ts";

describe("localised responses", () => {
  test("an API error response for a request with Accept-Language: fi carries the Finnish message", async ({
    ctx,
  }) => {
    const res = await ctx.app.request("/nope", { headers: { "accept-language": "fi" } });
    expect(res.status).toBe(404);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error).toMatchObject({ code: "not_found", message: "Ei löytynyt." });
    expect(res.headers.get("content-language")).toBe("fi");
    expect(res.headers.get("vary")).toContain("Accept-Language");
  });

  test("the code is the same in every language; only the message follows the header", async ({
    ctx,
  }) => {
    const messages = new Map<string, string>();
    for (const header of ["en", "fi-FI,fi;q=0.9,en;q=0.5", "sv", "de"]) {
      const res = await ctx.app.request("/nope", { headers: { "accept-language": header } });
      const body = ErrorResponse.parse(await res.json());
      expect(body.error.code).toBe("not_found");
      messages.set(header, body.error.message);
    }
    expect(Object.fromEntries(messages)).toEqual({
      en: "Not found.",
      "fi-FI,fi;q=0.9,en;q=0.5": "Ei löytynyt.",
      sv: "Hittades inte.",
      de: "Not found.",
    });
  });

  test("no header: English", async ({ ctx }) => {
    const res = await ctx.app.request("/nope");
    expect(ErrorResponse.parse(await res.json()).error.message).toBe("Not found.");
    expect(res.headers.get("content-language")).toBe("en");
  });

  test("an unhandled error is localised and still says nothing about its cause", async ({
    ctx,
  }) => {
    ctx.app.get("/boom", () => {
      throw new Error("relation accounts does not exist");
    });
    const res = await ctx.app.request("/boom", { headers: { "accept-language": "fi" } });
    expect(res.status).toBe(500);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.message).toBe("Jokin meni vikaan meidän päässämme.");
    expect(JSON.stringify(body)).not.toContain("accounts");
  });

  test("an AppError code without a catalogue message keeps the route's own message", async ({
    ctx,
  }) => {
    ctx.app.get("/teapot", () => {
      throw new AppError(418, "teapot", "I am a teapot");
    });
    const res = await ctx.app.request("/teapot", { headers: { "accept-language": "fi" } });
    expect(ErrorResponse.parse(await res.json()).error).toMatchObject({
      code: "teapot",
      message: "I am a teapot",
    });
  });

  test("the rate limit answers in the request's language with the seconds left, as an ICU plural", async () => {
    const { logger } = await captureLogger();
    const app = createApp({
      config: testConfig({ RATE_LIMIT_PER_MINUTE: "1" }),
      logger,
      db: { query: () => Promise.reject(new Error("no database in this test")) },
    });
    const headers = { "accept-language": "fi", "x-forwarded-for": "203.0.113.7" };
    await app.request("/nope", { headers });
    const res = await app.request("/nope", { headers });
    expect(res.status).toBe(429);
    const seconds = Number(res.headers.get("retry-after"));
    expect(ErrorResponse.parse(await res.json()).error.message).toBe(
      `Liian monta pyyntöä. Yritä uudelleen ${seconds} sekunnin kuluttua.`,
    );
  });

  test("an unknown key is a type error in the API too", () => {
    const probe = (t: import("@kuutti/i18n").TFunction) => {
      // Compile-time assertion: tsc fails on an unused @ts-expect-error.
      // @ts-expect-error not a key of messages.yaml
      t("does.not.exist");
    };
    expect(probe).toBeTypeOf("function");
  });
});
