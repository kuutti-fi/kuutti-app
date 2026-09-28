import { GateResponse, WaitlistResponse } from "@kuutti/schema";
import { ApiError, api } from "@/lib/api";

// The pond as the app reads it, through the typed client; the zod contracts
// guard the runtime (ADR-003).

/** The waitlist counter (#54, ADR-013): the public route. */
export async function fetchWaitlist(): Promise<WaitlistResponse> {
  const { data, response } = await api.GET("/waitlist");
  if (!data) throw new ApiError(`waitlist answered ${response.status}`, response.status);
  return WaitlistResponse.parse(data);
}

/** The person's own place at the gate (#94, ADR-015): asked with their session. */
export async function fetchGate(): Promise<GateResponse> {
  const { data, response } = await api.GET("/gate");
  if (!data) throw new ApiError(`gate answered ${response.status}`, response.status);
  return GateResponse.parse(data);
}
