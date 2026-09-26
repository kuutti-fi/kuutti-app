import { CONSENT_VERSIONS } from "@kuutti/i18n";
import type { AccountExport, ConsentsResponse } from "@kuutti/schema";
import { useCallback, useEffect, useState } from "react";
import { Platform, Share, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";
import { consentLocale, fetchConsents, giveConsent, withdrawResearch } from "./onboarding/client";
import { useSession } from "./session";

/** Days before the same person may register again (TD-7); the API's constant, repeated for the text. */
export const REREGISTER_COOLDOWN_DAYS = 30;

type Busy = { kind: "idle" } | { kind: "exporting" } | { kind: "deleting" };
type Notice = { kind: "export_failed" } | { kind: "delete_failed" } | null;

/**
 * Hands the export to the system share sheet on the phone; the web preview
 * has no share sheet and downloads a file instead. Injected so tests can see
 * what was handed over without a native sheet.
 */
export async function shareExport(
  data: AccountExport,
  title: string,
  share: typeof Share.share = Share.share,
): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kuutti-export.json";
    a.click();
    // The browser queues the download asynchronously; revoking at once can
    // leave it with nothing to save.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  await share({ title, message: json });
}

type ResearchState = "loading" | "unavailable" | "on" | "off" | "outdated";

const bundledResearchVersion = (): string => CONSENT_VERSIONS.research ?? "";

/**
 * The research opt-in as a switch on the account card (#46, ADR-010 §4): on
 * when an active research consent names the current wording, off otherwise;
 * a change is a POST or a DELETE, both answered with the consents as stored.
 * When the wording built into this app is older than the API's, the switch
 * is locked with the "update the app" line: no consent for a text this app
 * never showed.
 */
function useResearchOptIn(signedIn: boolean, locale: string) {
  const [state, setState] = useState<ResearchState>("loading");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const apply = useCallback((consents: ConsentsResponse) => {
    const current = consents.currentVersions.research;
    if (bundledResearchVersion() !== current) {
      setState("outdated");
      return;
    }
    const active = consents.consents.some(
      (c) => c.kind === "research" && c.withdrawnAt === null && c.version === current,
    );
    setState(active ? "on" : "off");
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchConsents()
      .then((consents) => live && apply(consents))
      .catch(() => live && setState("unavailable"));
    return () => {
      live = false;
    };
  }, [signedIn, apply]);
  const set = useCallback(
    async (on: boolean) => {
      setBusy(true);
      setFailed(false);
      try {
        apply(
          on
            ? await giveConsent("research", bundledResearchVersion(), consentLocale(locale))
            : await withdrawResearch(),
        );
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [apply, locale],
  );
  return { state, busy, failed, set };
}

/**
 * The account card (#51, ADR-007): the data export and the deletion, on the
 * home screen until the profile gives them a home. Deletion is a button
 * behind a confirmation that names the cooldown; never a swipe, never colour
 * alone (CLAUDE.md Accessibility).
 */
export function AccountActions({ share }: { share?: typeof Share.share }) {
  const { t, locale } = useT();
  const session = useSession();
  const tap = useHapticTap();
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });
  const [notice, setNotice] = useState<Notice>(null);
  const [confirming, setConfirming] = useState(false);
  const research = useResearchOptIn(session.status === "signed-in", locale);

  if (session.status !== "signed-in") return null;

  const exportData = async () => {
    tap();
    setNotice(null);
    setBusy({ kind: "exporting" });
    try {
      const data = await session.exportData();
      await shareExport(data, t("account.export.title"), share);
    } catch {
      setNotice({ kind: "export_failed" });
    } finally {
      setBusy({ kind: "idle" });
    }
  };

  const deleteAccount = async () => {
    setConfirming(false);
    setNotice(null);
    setBusy({ kind: "deleting" });
    try {
      await session.deleteAccount();
      // The provider flips to signed-out; this card unmounts with it.
    } catch {
      setNotice({ kind: "delete_failed" });
      setBusy({ kind: "idle" });
    }
  };

  return (
    <Card className="w-full max-w-md">
      <View accessibilityLabel={t("account.title")} className="gap-6">
        <CardHeader>
          <CardTitle>{t("account.title")}</CardTitle>
          <CardDescription>{t("account.export.explain")}</CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          {notice && (
            <Text accessibilityLiveRegion="assertive">
              {notice.kind === "export_failed"
                ? t("account.export.failed")
                : t("account.delete.failed")}
            </Text>
          )}
          {busy.kind !== "idle" && (
            <Text accessibilityLiveRegion="polite">
              {busy.kind === "exporting"
                ? t("account.export.working")
                : t("account.delete.working")}
            </Text>
          )}
          {(research.state === "on" ||
            research.state === "off" ||
            research.state === "outdated") && (
            <View className="gap-2">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1">{t("account.research.label")}</Text>
                <Switch
                  accessibilityLabel={t("account.research.label")}
                  checked={research.state === "on"}
                  disabled={research.busy || research.state === "outdated"}
                  onCheckedChange={(on) => {
                    tap();
                    void research.set(on);
                  }}
                />
              </View>
              <Text variant="muted">
                {research.state === "outdated"
                  ? t("onboarding.consents.outdatedApp")
                  : t("account.research.explain")}
              </Text>
              {research.failed && (
                <Text accessibilityLiveRegion="assertive">{t("account.research.failed")}</Text>
              )}
            </View>
          )}
          <Button
            variant="outline"
            accessibilityLabel={t("account.export.button")}
            disabled={busy.kind !== "idle"}
            onPress={() => void exportData()}
          >
            <Text>{t("account.export.button")}</Text>
          </Button>
          <Button
            variant="destructive"
            accessibilityLabel={t("account.delete.button")}
            disabled={busy.kind !== "idle"}
            onPress={() => {
              tap();
              setConfirming(true);
            }}
          >
            <Text>{t("account.delete.button")}</Text>
          </Button>
        </CardContent>
      </View>

      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent closeLabel={t("account.delete.close")}>
          <DialogHeader>
            <DialogTitle>{t("account.delete.title")}</DialogTitle>
            <DialogDescription>
              {t("account.delete.body", { days: REREGISTER_COOLDOWN_DAYS })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onPress={() => setConfirming(false)}>
              {t("account.delete.cancel")}
            </Button>
            <Button variant="destructive" onPress={() => void deleteAccount()}>
              {t("account.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
