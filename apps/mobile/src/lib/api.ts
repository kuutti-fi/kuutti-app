import { type ApiPaths, HealthResponse } from "@kuutti/schema";
import Constants from "expo-constants";
import createClient from "openapi-fetch";

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
  // A release bundle without the variable would silently talk to nothing;
  // EAS environments and CI both set it (apps/mobile/README.md, API URLs).
  if (!__DEV__) throw new Error("EXPO_PUBLIC_API_URL is not set for this build");
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

/**
 * Typed client over the generated OpenAPI paths (ADR-003). Types come from
 * packages/schema/src/api.generated.ts; the zod contracts guard the runtime.
 */
export const api = createClient<ApiPaths>({
  baseUrl: apiBaseUrl(),
  // Resolve fetch at call time: React Native may install it after this module loads, and tests mock it.
  fetch: (request) => globalThis.fetch(request),
});

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const { data, error, response } = await api.GET("/health", { signal });
  if (error !== undefined || data === undefined) {
    throw new ApiError(`API answered ${response.status}`, response.status);
  }
  return HealthResponse.parse(data);
}
