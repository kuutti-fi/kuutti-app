import type { HealthResponse } from "@kuutti/schema";
import * as Updates from "expo-updates";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { apiBaseUrl, fetchHealth } from "@/lib/api";
import { useHapticTap } from "@/theme/haptics";
import { DevSettings } from "./DevSettings";

type State =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

// The appearance sheet is for the team: every build except the store's.
const SHOW_DEV_SETTINGS = Updates.channel !== "production";

/**
 * M1 smoke screen: proves the app boots and reaches the API, and is the first
 * screen built on the UI primitives and tokens (#12). Localised in #13;
 * strings are inline until then. It scrolls, so the largest OS font size
 * never clips anything.
 */
export function SmokeScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const tap = useHapticTap();

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const health = await fetchHealth();
      setState({ kind: "ok", health });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      {SHOW_DEV_SETTINGS && (
        <View className="flex-row justify-end px-2">
          <DevSettings />
        </View>
      )}
      <ScrollView contentContainerClassName="flex-grow items-center justify-center gap-4 p-6">
        <Text variant="h1" accessibilityRole="header">
          Kuutti
        </Text>
        <Text variant="muted">{apiBaseUrl()}</Text>

        <Card className="w-full max-w-md">
          {state.kind === "loading" && (
            <CardContent accessibilityLabel="Reaching the API" className="gap-3">
              <Text>Reaching the API…</Text>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          )}

          {state.kind === "ok" && (
            <View accessibilityLabel="API status" className="gap-6">
              <CardHeader>
                <CardTitle>API {state.health.version}</CardTitle>
                <CardDescription>commit {state.health.commit}</CardDescription>
              </CardHeader>
              <CardContent>
                <Text variant="muted">
                  db {state.health.db} · migrations {state.health.migrations}
                </Text>
              </CardContent>
            </View>
          )}

          {state.kind === "error" && (
            <View accessibilityLabel="API unreachable" className="gap-6">
              <CardHeader>
                {/* The words carry the state; the colour only repeats it. */}
                <CardTitle className="text-destructive">API unreachable</CardTitle>
                <CardDescription>{state.message}</CardDescription>
              </CardHeader>
            </View>
          )}
        </Card>

        <Button
          accessibilityLabel="Retry"
          onPress={() => {
            tap();
            void load();
          }}
        >
          <Icon as={RotateCw} />
          <Text>Retry</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
