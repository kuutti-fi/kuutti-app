import { z } from "zod";

/**
 * GET /health. 200 when every dependency answers, 503 with the same body
 * otherwise, so a load balancer and a human read the same thing.
 */
export const HealthResponse = z
  .object({
    status: z.enum(["ok", "degraded"]).meta({
      description: "ok when the database answers and migrations are current; degraded otherwise.",
    }),
    version: z.string().min(1).meta({ description: "APP_VERSION injected at build time." }),
    commit: z.string().min(1).meta({ description: "Short git commit the build was made from." }),
    builtAt: z.string().min(1).meta({ description: "ISO 8601 build timestamp." }),
    source: z.url({ protocol: /^https$/ }).meta({
      description:
        "Where the source of the running service is published (AGPL-3.0 section 13), to be read with `commit`. A modified deployment points this at its own source.",
    }),
    db: z.enum(["ok", "unreachable"]).meta({ description: "SELECT 1 answered within 500 ms." }),
    migrations: z.enum(["current", "pending"]).meta({
      description: "Committed migrations compared with the ones applied to this database.",
    }),
  })
  .meta({ id: "HealthResponse" });

export type HealthResponse = z.infer<typeof HealthResponse>;
