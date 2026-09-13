import { z } from "zod";

/**
 * The one error envelope every route returns. Detail stays in the logs; the
 * requestId links the two.
 */
export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().min(1).meta({ description: "Stable machine-readable code." }),
      message: z.string().min(1).meta({ description: "Short, generic, safe to show." }),
      requestId: z.string().min(1).meta({ description: "Matches the API log line." }),
    }),
  })
  .meta({ id: "ErrorResponse" });

export type ErrorResponse = z.infer<typeof ErrorResponse>;
