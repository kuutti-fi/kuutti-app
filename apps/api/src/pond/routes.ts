import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ErrorResponse, PondChoice, PondList } from "@kuutti/schema";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "../app.ts";
import { callerOf } from "../lib/auth-middleware.ts";
import type { AppEnv } from "../lib/env.ts";
import { AppError } from "../lib/errors.ts";
import * as repo from "./repo.ts";

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponse } },
});
const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const bearer = { security: [{ session: [] }] };
const unauthenticated = errorContent("unauthenticated, session_expired or session_revoked.");

const listRoute = createRoute({
  method: "get",
  path: "/ponds",
  summary: "The ponds a person can choose",
  description:
    "Every pond with both Finnish case forms (TD-17), parents first. Where matching happens (TD-10); the choice is one per account.",
  ...bearer,
  responses: {
    200: { description: "The ponds.", ...json(PondList) },
    401: unauthenticated,
  },
});

const chooseRoute = createRoute({
  method: "put",
  path: "/account/pond",
  summary: "Choose the caller's pond",
  ...bearer,
  request: { body: { required: true, ...json(PondChoice) } },
  responses: {
    204: { description: "Chosen." },
    400: errorContent("Validation failed, or pond_unknown."),
    401: unauthenticated,
    404: errorContent("No live account (erased meanwhile)."),
  },
});

export function pondRoutes(deps: Deps, requireSession: MiddlewareHandler<AppEnv>) {
  const app = new OpenAPIHono<AppEnv>();
  for (const path of new Set([listRoute, chooseRoute].map((r) => r.getRoutingPath()))) {
    app.use(path, requireSession);
  }

  app.openapi(listRoute, async (c) => {
    return c.json({ ponds: await repo.listPonds(deps.db) }, 200);
  });

  app.openapi(chooseRoute, async (c) => {
    const { pondId } = c.req.valid("json");
    const { accountId } = callerOf(c);
    const outcome = await repo.setPondOfAccount(deps.db, accountId, pondId);
    if (outcome === "no_pond") throw new AppError(400, "pond_unknown", "No such pond", { pondId });
    if (outcome === "no_account") throw new AppError(404, "not_found", "No live account");
    deps.logger.info({ accountId, pondId }, "pond chosen");
    return c.body(null, 204);
  });

  return app;
}
