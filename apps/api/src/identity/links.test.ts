import { describe, expect } from "vitest";
import { createApp } from "../app.ts";
import { captureLogger, test, testConfig } from "../test/harness.ts";
import { ANDROID_PACKAGE, IOS_BUNDLE_ID, RETURN_PATH } from "./links.ts";

// The verified-links files (#36): shape and headers as Google and Apple read
// them, and 404 until the environment has the values.

const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, "0"))
  .join(":")
  .toUpperCase();

async function appWith(ctx: { client: Parameters<typeof createApp>[0]["db"] }, overrides = {}) {
  const { logger } = await captureLogger();
  return createApp({ config: testConfig(overrides), logger, db: ctx.client });
}

describe("verified links", () => {
  test("assetlinks.json names the package and every configured fingerprint", async ({ ctx }) => {
    const app = await appWith(ctx, {
      ANDROID_CERT_FINGERPRINTS: `${FINGERPRINT.toLowerCase()} , ${FINGERPRINT}`,
    });
    const res = await app.request("/.well-known/assetlinks.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await res.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: [FINGERPRINT, FINGERPRINT],
        },
      },
    ]);
  });

  test("the AASA names the team, the bundle and the return path, as application/json", async ({
    ctx,
  }) => {
    const app = await appWith(ctx, { IOS_TEAM_ID: "HM4J7X495K" });
    const res = await app.request("/.well-known/apple-app-site-association");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = await res.json();
    expect(body.applinks.details[0].appIDs).toEqual([`HM4J7X495K.${IOS_BUNDLE_ID}`]);
    expect(body.applinks.details[0].components[0]["/"]).toBe(`${RETURN_PATH}*`);
  });

  test("both answer 404 until the environment has the values; a malformed value fails the boot", async ({
    ctx,
  }) => {
    const app = await appWith(ctx);
    expect((await app.request("/.well-known/assetlinks.json")).status).toBe(404);
    expect((await app.request("/.well-known/apple-app-site-association")).status).toBe(404);
    expect(() => testConfig({ ANDROID_CERT_FINGERPRINTS: "AB:CD" })).toThrow(/fingerprints/);
    expect(() => testConfig({ IOS_TEAM_ID: "short" })).toThrow(/ten characters/);
  });
});
