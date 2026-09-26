import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { AccountDeletionRequest, AccountExport, ErrorResponse } from "@kuutti/schema";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "../app.ts";
import { callerOf } from "../lib/auth-middleware.ts";
import type { AppEnv } from "../lib/env.ts";
import { type ErasureDeps, eraseAccount, exportAccount } from "./erasure.ts";

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponse } },
});
const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const bearer = { security: [{ session: [] }] };

const deleteRoute = createRoute({
  method: "post",
  path: "/account/delete",
  summary: "Delete this account",
  description:
    "Erasure per TD-7: every session, login attempt, photo (with its objects unless another account shares them), review row and fetch log entry goes; the account row stays as an anonymised tombstone and the identity keeps a deletion count and a 30-day cooldown before a new account. The audit log is untouched. The body confirms; the app asks first.",
  ...bearer,
  request: { body: { required: true, ...json(AccountDeletionRequest) } },
  responses: {
    204: { description: "Erased. Every token of this account has stopped working." },
    400: errorContent("Validation failed (confirm missing)."),
    401: errorContent("unauthenticated, session_expired or session_revoked."),
    404: errorContent(
      "No live account: a second deletion that passed the session guard before the first committed (not_found).",
    ),
  },
});

const exportRoute = createRoute({
  method: "get",
  path: "/account/export",
  summary: "Everything Kuutti holds about this account",
  description:
    "One JSON document: the account, the identity's dates and login level, the devices signed in, the photos with fifteen-minute URLs and their moderation outcome, and the person's own fetch log. Nothing about anyone else.",
  ...bearer,
  responses: {
    200: { description: "The export.", ...json(AccountExport) },
    401: errorContent("unauthenticated, session_expired or session_revoked."),
  },
});

export function accountRoutes(deps: Deps, requireSession: MiddlewareHandler<AppEnv>) {
  const app = new OpenAPIHono<AppEnv>();
  const erasureDeps: ErasureDeps = {
    db: deps.db,
    logger: deps.logger,
    now: () => new Date(),
    ...(deps.media ? { media: deps.media } : {}),
  };
  for (const path of new Set([deleteRoute, exportRoute].map((r) => r.getRoutingPath()))) {
    app.use(path, requireSession);
  }

  app.openapi(deleteRoute, async (c) => {
    c.req.valid("json"); // confirm: true, or the validator has answered 400
    await eraseAccount(erasureDeps, callerOf(c).accountId);
    return c.body(null, 204);
  });

  app.openapi(exportRoute, async (c) => {
    const body = await exportAccount(erasureDeps, callerOf(c).accountId);
    c.header("Content-Disposition", 'attachment; filename="kuutti-export.json"');
    c.header("Cache-Control", "no-store");
    return c.json(body, 200);
  });

  return app;
}
