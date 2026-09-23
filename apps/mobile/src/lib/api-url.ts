import Constants from "expo-constants";

/**
 * API base URL. EXPO_PUBLIC_API_URL wins (set per EAS profile and per preview);
 * in local dev it is derived from the Metro host so a phone on the same network
 * reaches the API on the developer's machine. Never a secret: EXPO_PUBLIC_* is
 * public by definition.
 */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) {
    // Session tokens travel in the header (#35): a release build never talks plain http.
    if (!__DEV__ && !fromEnv.startsWith("https://")) {
      throw new Error("EXPO_PUBLIC_API_URL must be https in a release build");
    }
    return fromEnv.replace(/\/$/, "");
  }
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host) return `http://${host}:3000`;
  // A release bundle without the variable would silently talk to nothing;
  // EAS environments and CI both set it (apps/mobile/README.md, API URLs).
  if (!__DEV__) throw new Error("EXPO_PUBLIC_API_URL is not set for this build");
  return "http://localhost:3000";
}
