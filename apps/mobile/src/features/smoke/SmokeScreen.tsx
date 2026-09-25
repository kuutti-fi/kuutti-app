import type { HealthResponse } from "@kuutti/schema";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
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
import { useSession } from "@/features/identity";
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
  const session = useSession();
  const router = useRouter();

  // The app's own git commit, as opposed to the API's: app.config.ts stamped
  // it into the config when this JavaScript was exported or built.
  const appCommit: unknown = Constants.expoConfig?.extra?.commit;
  const appCommitLine =
    typeof appCommit === "string" && appCommit.length > 0
      ? t("smoke.status.commit", { commit: appCommit })
      : t("smoke.app.noCommit");

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
        {/* An address has no spaces to wrap at; centred with its own width it runs
            off the screen at the largest font size (#31). Full width lets it break. */}
        <Text variant="muted" className="w-full max-w-md text-center">
          {apiBaseUrl()}
        </Text>

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
                <CardTitle>{t("smoke.api.title")}</CardTitle>
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

        <Card className="w-full max-w-md">
          <View accessibilityLabel={t("smoke.app.label")} className="gap-6">
            <CardHeader>
              <CardTitle>{t("smoke.app.title")}</CardTitle>
              <CardDescription>{appCommitLine}</CardDescription>
            </CardHeader>
          </View>
        </Card>

        {/* Whether this device holds a session (#35, #36): the session's id
            names the device, never the person. */}
        <Card className="w-full max-w-md">
          <View accessibilityLabel={t("smoke.session.label")} className="gap-6">
            <CardHeader>
              <CardTitle>{t("smoke.session.title")}</CardTitle>
              <CardDescription>
                {session.status === "signed-in"
                  ? t("smoke.session.signedIn", { session: session.sessionId.slice(0, 8) })
                  : session.status === "loading"
                    ? t("smoke.loading")
                    : t("smoke.session.signedOut")}
              </CardDescription>
            </CardHeader>
            {session.status === "signed-out" && (
              <CardContent>
                <Button
                  variant="outline"
                  accessibilityLabel={t("smoke.session.signIn")}
                  onPress={() => {
                    tap();
                    router.push("/sign-in");
                  }}
                >
                  <Text>{t("smoke.session.signIn")}</Text>
                </Button>
              </CardContent>
            )}
            {session.status === "signed-in" && (
              <CardContent>
                {/* The photos screen (#48) until the profile (#47) gives it a home. */}
                <Button
                  variant="outline"
                  accessibilityLabel={t("smoke.photos.open")}
                  onPress={() => {
                    tap();
                    router.push("/photos");
                  }}
                >
                  <Text>{t("smoke.photos.open")}</Text>
                </Button>
              </CardContent>
            )}
          </View>
        </Card>

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

        {state.kind === "ok" && <SourceOffer source={state.health.source} />}
      </ScrollView>
    </SafeAreaView>
  );
}
