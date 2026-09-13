import { HealthResponse } from "@kuutti/schema";
import Constants from "expo-constants";

/**
 * API base URL. EXPO_PUBLIC_API_URL wins (set per EAS profile and per preview);
 * in local dev it is derived from the Metro host so a phone on the same network
 * reaches the API on the developer's machine. Never a secret: EXPO_PUBLIC_* is
 * public by definition.
 */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host) return `http://${host}:3000`;
  return "http://localhost:3000";
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch(`${apiBaseUrl()}/health`, { signal });
  if (!res.ok) throw new ApiError(`API answered ${res.status}`, res.status);
  const parsed = HealthResponse.safeParse(await res.json());
  if (!parsed.success) throw new ApiError("API answered with an unexpected shape");
  return parsed.data;
}
