import { z } from "zod";

/**
 * GET /health. Issue #3 extends this with database reachability and
 * migration state; the smoke screen (#2) reads version and commit.
 */
export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string().min(1),
  commit: z.string().min(1),
  builtAt: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
