import { Hono } from "hono";
import { health } from "./health/index.ts";
import { corsAllowlist } from "./lib/cors.ts";

// Middleware order, error envelope, config and logging arrive with issue #3.
export const app = new Hono().use("*", corsAllowlist()).route("/", health);

export type App = typeof app;
