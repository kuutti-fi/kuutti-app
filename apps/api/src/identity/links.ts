import { Hono } from "hono";
import type { Deps } from "../app.ts";
import type { AppEnv } from "../lib/env.ts";
import { localisedEnvelope } from "../lib/errors.ts";

/**
 * The two files that make the bank login's return land in the app instead of
 * a browser tab (#36): Android App Links verify the package against the
 * release certificate's fingerprint, iOS Universal Links the bundle against
 * the team. Served by the API from configuration (rules/mobile.md), so a new
 * keystore or team is a parameter change, not a native build. Machine callers
 * (Google's and Apple's verifiers), so plain routes with the exact media type
 * each expects and a day of caching.
 */
export const ANDROID_PACKAGE = "fi.kuutti.app";
export const IOS_BUNDLE_ID = "fi.kuutti.app";
/** The https return path the app will claim once the native batch ships the intent filters. */
export const RETURN_PATH = "/auth/return";

const CACHE = "public, max-age=86400";

export function wellKnownRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const fingerprints = (deps.config.ANDROID_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => f.length > 0);
  const team = deps.config.IOS_TEAM_ID;

  app.get("/.well-known/assetlinks.json", (c) => {
    if (fingerprints.length === 0) return c.json(localisedEnvelope(c, "not_found"), 404);
    c.header("cache-control", CACHE);
    return c.json(
      [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: ANDROID_PACKAGE,
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ],
      200,
    );
  });

  app.get("/.well-known/apple-app-site-association", (c) => {
    if (!team) return c.json(localisedEnvelope(c, "not_found"), 404);
    c.header("cache-control", CACHE);
    // Apple wants application/json without a charset and no redirect.
    c.header("content-type", "application/json");
    return c.body(
      JSON.stringify({
        applinks: {
          apps: [],
          details: [
            {
              appIDs: [`${team}.${IOS_BUNDLE_ID}`],
              components: [{ "/": `${RETURN_PATH}*`, comment: "the bank login's return" }],
            },
          ],
        },
      }),
      200,
    );
  });

  return app;
}
