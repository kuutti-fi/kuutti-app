import type { RequestIdVariables } from "hono/request-id";

/** Hono environment shared by every route and middleware: the request id variable. */
export type AppEnv = { Variables: RequestIdVariables };
