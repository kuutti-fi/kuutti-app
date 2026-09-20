import type { HealthResponse } from "@kuutti/schema";
import { Image } from "expo-image";
import * as Updates from "expo-updates";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import { cssInterop } from "nativewind";
import { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { apiBaseUrl, fetchHealth } from "@/lib/api";
import { useT } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { DECORATIVE } from "@/theme/a11y";
import { useHapticTap } from "@/theme/haptics";
import { DevSettings } from "./DevSettings";
import { SourceOffer } from "./SourceOffer";

type State =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

// The appearance sheet is for the team: every build except the store's.
const SHOW_DEV_SETTINGS = Updates.channel !== "production";

// The mark is black ink on transparency (assets/logo-mark.png, made by
// scripts/logo from docs/design/logo), tinted with the foreground token so it
// follows all four theme sets: the text colour class is handed over as
// tintColor, the way Icon does it for lucide. That hand-over is native only;
// on the web target the ink is inverted under the dark class instead, and both
// dark foregrounds are near white.
const Mark = cssInterop(Image, {
  className: { target: "style", nativeStyleToProp: { color: "tintColor" } },
});
const MARK = require("../../../assets/logo-mark.png");
const MARK_CLASS = cn("h-24 w-24 text-foreground", Platform.select({ web: "dark:invert" }));

/**
 * M1 smoke screen: proves the app boots and reaches the API, and is the first
 * screen built on the UI primitives and tokens (#12) with every string from
 * messages.yaml (#13). It scrolls, so the largest OS font size and the longest
 * language never clip anything.
 */
export function SmokeScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const tap = useHapticTap();
  const { t } = useT();

  // Which JavaScript the phone runs: the EAS Update it applied, or the bundle
  // embedded in the build. The API's version in the card says nothing about
  // it, and "did it really update?" is the first question asked on a device.
  // A Metro session has updates disabled and shows nothing.
  const bundle = !Updates.isEnabled
    ? null
    : Updates.isEmbeddedLaunch || !Updates.updateId || !Updates.createdAt
      ? t("smoke.status.embedded")
      : t("smoke.status.app", { id: Updates.updateId.slice(0, 8), date: Updates.createdAt });

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
        <View className="flex-row justify-start px-2">
          <DevSettings />
        </View>
      )}
      <ScrollView contentContainerClassName="flex-grow items-center justify-center gap-4 p-6">
        <Mark source={MARK} contentFit="contain" className={MARK_CLASS} {...DECORATIVE} />
        <Text variant="h1" accessibilityRole="header">
          {t("smoke.title")}
        </Text>
        <Text variant="muted">{apiBaseUrl()}</Text>

        <Card className="w-full max-w-md">
          {state.kind === "loading" && (
            <CardContent accessibilityLabel={t("smoke.loading")} className="gap-3">
              <Text>{t("smoke.loading")}</Text>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          )}

          {state.kind === "ok" && (
            <View accessibilityLabel={t("smoke.status.label")} className="gap-6">
              <CardHeader>
                <CardTitle>
                  {t("smoke.status.version", { version: state.health.version })}
                </CardTitle>
                <CardDescription>
                  {t("smoke.status.commit", { commit: state.health.commit })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Text variant="muted">
                  {t("smoke.status.database", {
                    db: state.health.db,
                    migrations: state.health.migrations,
                  })}
                </Text>
              </CardContent>
            </View>
          )}

          {state.kind === "error" && (
            <View accessibilityLabel={t("smoke.unreachable.title")} className="gap-6">
              <CardHeader>
                {/* The words carry the state; the colour only repeats it. */}
                <CardTitle className="text-destructive">{t("smoke.unreachable.title")}</CardTitle>
                <CardDescription>{state.message}</CardDescription>
              </CardHeader>
            </View>
          )}
        </Card>

        {bundle && <Text variant="muted">{bundle}</Text>}

        <Button
          accessibilityLabel={t("smoke.retry")}
          onPress={() => {
            tap();
            void load();
          }}
        >
          <Icon as={RotateCw} />
          <Text>{t("smoke.retry")}</Text>
        </Button>

        {state.kind === "ok" && (
          <SourceOffer source={state.health.source} commit={state.health.commit} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
