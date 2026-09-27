import { WaitlistResponse } from "@kuutti/schema";
import { ApiError, api } from "@/lib/api";

// The waitlist counter as the app reads it (#54, ADR-013): the public route,
// through the typed client; the zod contract guards the runtime (ADR-003).

export async function fetchWaitlist(): Promise<WaitlistResponse> {
  const { data, response } = await api.GET("/waitlist");
  if (!data) throw new ApiError(`waitlist answered ${response.status}`, response.status);
  return WaitlistResponse.parse(data);
}
