import * as Sentry from "@sentry/react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { sentryOptions } from "@/lib/sentry";

// Error reporting (#11): on exactly when EXPO_PUBLIC_SENTRY_DSN is set for the
// build or update; options in src/lib/sentry.ts, asserted by its test.
Sentry.init(sentryOptions({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, channel: Updates.channel }));

// Routes stay thin and delegate to src/features/<slice>/ (rules/layout.md).
function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </>
  );
}

export default Sentry.wrap(RootLayout);
