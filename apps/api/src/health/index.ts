import { HealthResponse } from "@kuutti/schema";
import { Hono } from "hono";
import { buildInfo } from "../lib/version.ts";

// Issue #3 adds database reachability and migration state.
export const health = new Hono().get("/health", (c) => {
  const body: HealthResponse = {
    status: "ok",
    version: buildInfo.version,
    commit: buildInfo.commit,
    builtAt: buildInfo.builtAt,
  };
  return c.json(HealthResponse.parse(body));
});
