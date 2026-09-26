import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ErrorResponse, PreferencesResponse, PreferencesUpdate } from "@kuutti/schema";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "../app.ts";
import { callerOf } from "../lib/auth-middleware.ts";
import type { AppEnv } from "../lib/env.ts";
import { AppError } from "../lib/errors.ts";
import { readPreferences, savePreferences } from "./preferences.ts";

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponse } },
});
const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const bearer = { security: [{ session: [] }] };
const unauthenticated = errorContent("unauthenticated, session_expired or session_revoked.");

const readRoute = createRoute({
  method: "get",
  path: "/preferences",
  summary: "Whom the caller seeks and the age window",
  description:
    "The two hard filters of rule 7 as the person set them; null until onboarding sets them.",
  ...bearer,
  responses: {
    200: { description: "The preferences.", ...json(PreferencesResponse) },
    401: unauthenticated,
  },
});

const saveRoute = createRoute({
  method: "put",
  path: "/preferences",
  summary: "Set whom the caller seeks and the age window",
  description:
    "Both at once: a non-empty set of genders and an age window within 18 and 99 with min at most max. Hard rows: the round builder never crosses them, in either direction.",
  ...bearer,
  request: { body: { required: true, ...json(PreferencesUpdate) } },
  responses: {
    200: { description: "Saved; the preferences as stored.", ...json(PreferencesResponse) },
    400: errorContent("Validation failed."),
    401: unauthenticated,
    404: errorContent("No live account (erased meanwhile)."),
  },
});

export function preferencesRoutes(deps: Deps, requireSession: MiddlewareHandler<AppEnv>) {
  const app = new OpenAPIHono<AppEnv>();
  for (const path of new Set([readRoute, saveRoute].map((r) => r.getRoutingPath()))) {
    app.use(path, requireSession);
  }

  app.openapi(readRoute, async (c) => {
    return c.json(await readPreferences(deps.db, callerOf(c).accountId), 200);
  });

  app.openapi(saveRoute, async (c) => {
    const update = c.req.valid("json");
    const { accountId } = callerOf(c);
    if (!(await savePreferences(deps.db, accountId, update, new Date()))) {
      throw new AppError(404, "not_found", "No live account");
    }
    // The values stay out of the log (rule 5): this line says only that they were set.
    deps.logger.info({ accountId }, "preferences saved");
    return c.json(await readPreferences(deps.db, accountId), 200);
  });

  return app;
}
