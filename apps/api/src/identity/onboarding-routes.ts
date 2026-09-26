import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ConsentRequest,
  ConsentsResponse,
  ErrorResponse,
  GenderUpdate,
  OnboardingStatus,
} from "@kuutti/schema";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "../app.ts";
import { callerOf } from "../lib/auth-middleware.ts";
import type { AppEnv } from "../lib/env.ts";
import {
  consentsOf,
  declareGender,
  giveConsent,
  type OnboardingDeps,
  onboardingStatus,
  withdrawResearchConsent,
} from "./onboarding.ts";

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponse } },
});
const json = <T>(schema: T) => ({ content: { "application/json": { schema } } });
const bearer = { security: [{ session: [] }] };
const unauthenticated = errorContent("unauthenticated, session_expired or session_revoked.");

const statusRoute = createRoute({
  method: "get",
  path: "/onboarding",
  summary: "What the caller has answered and what activation still waits for",
  description:
    "Gender, pond, the two hard preferences, the consents given for the current wordings and the current versions. When nothing required is missing and the account is still registered, it becomes active here.",
  ...bearer,
  responses: {
    200: { description: "The status.", ...json(OnboardingStatus) },
    401: unauthenticated,
  },
});

const genderRoute = createRoute({
  method: "put",
  path: "/account/gender",
  summary: "Declare the caller's gender",
  description: "Self-declared, one of a closed list (rule 3); nothing from the bank informs it.",
  ...bearer,
  request: { body: { required: true, ...json(GenderUpdate) } },
  responses: {
    204: { description: "Declared." },
    400: errorContent("Validation failed."),
    401: unauthenticated,
    404: errorContent("No live account (erased meanwhile)."),
  },
});

const consentsRoute = createRoute({
  method: "get",
  path: "/consents",
  summary: "Every consent the caller has given, and the current versions",
  ...bearer,
  responses: {
    200: { description: "The consents.", ...json(ConsentsResponse) },
    401: unauthenticated,
  },
});

const consentRoute = createRoute({
  method: "post",
  path: "/consents",
  summary: "Record a consent for the current wording",
  description:
    "The kind, the consent_version the person read and the language it was shown in. An old version is refused with agreement_outdated; the same consent twice is recorded once.",
  ...bearer,
  request: { body: { required: true, ...json(ConsentRequest) } },
  responses: {
    200: { description: "Recorded; the consents as stored.", ...json(ConsentsResponse) },
    400: errorContent("Validation failed."),
    401: unauthenticated,
    404: errorContent("No live account (erased meanwhile)."),
    409: errorContent("agreement_outdated: the wording has a newer version."),
  },
});

const withdrawRoute = createRoute({
  method: "delete",
  path: "/consents/research",
  summary: "Withdraw the research opt-in",
  description:
    "The one consent a person withdraws; terms and privacy end with the account. The rows stay as the record of what was agreed and when.",
  ...bearer,
  responses: {
    200: { description: "Withdrawn; the consents as stored.", ...json(ConsentsResponse) },
    401: unauthenticated,
  },
});

export function onboardingRoutes(deps: Deps, requireSession: MiddlewareHandler<AppEnv>) {
  const app = new OpenAPIHono<AppEnv>();
  const onboardingDeps: OnboardingDeps = {
    db: deps.db,
    logger: deps.logger,
    now: () => new Date(),
  };
  const routes = [statusRoute, genderRoute, consentsRoute, consentRoute, withdrawRoute];
  for (const path of new Set(routes.map((r) => r.getRoutingPath()))) {
    app.use(path, requireSession);
  }

  app.openapi(statusRoute, async (c) => {
    return c.json(await onboardingStatus(onboardingDeps, callerOf(c).accountId), 200);
  });

  app.openapi(genderRoute, async (c) => {
    await declareGender(onboardingDeps, callerOf(c).accountId, c.req.valid("json").gender);
    return c.body(null, 204);
  });

  app.openapi(consentsRoute, async (c) => {
    return c.json(await consentsOf(onboardingDeps, callerOf(c).accountId), 200);
  });

  app.openapi(consentRoute, async (c) => {
    return c.json(
      await giveConsent(onboardingDeps, callerOf(c).accountId, c.req.valid("json")),
      200,
    );
  });

  app.openapi(withdrawRoute, async (c) => {
    return c.json(await withdrawResearchConsent(onboardingDeps, callerOf(c).accountId), 200);
  });

  return app;
}
