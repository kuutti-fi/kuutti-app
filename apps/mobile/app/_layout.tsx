import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

// Routes stay thin and delegate to src/features/<slice>/ (rules/layout.md).
export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </>
  );
}
