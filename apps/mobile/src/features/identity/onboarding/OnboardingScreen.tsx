import { CONSENT_VERSIONS, type PlainMessageKey } from "@kuutti/i18n";
import {
  AGE_MAX,
  AGE_MIN,
  AgeWindow,
  type ConsentKind,
  GENDERS,
  type Gender,
  type OnboardingStatus,
  type PondSummary,
} from "@kuutti/schema";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";
import { choosePond, declareGender, giveConsent, savePreferences } from "./client";
import { useOnboarding } from "./useOnboarding";

type Step = "consents" | "gender" | "seeks" | "age" | "pond" | "research" | "done";
const STEPS: Step[] = ["consents", "gender", "seeks", "age", "pond", "research"];

/**
 * The next question, from what the API says is missing. The two consents
 * come first: nothing personal is asked before the person has read what
 * happens to it (#46 review, ADR-010 §9). Research is offered once and
 * never required.
 */
export function nextStep(status: OnboardingStatus, researchOffered: boolean): Step {
  const missing = new Set(status.missing);
  if (missing.has("terms") || missing.has("privacy")) return "consents";
  if (missing.has("gender")) return "gender";
  if (missing.has("seeks")) return "seeks";
  if (missing.has("age_window")) return "age";
  if (missing.has("pond")) return "pond";
  if (!status.consents.research && !researchOffered) return "research";
  return "done";
}

/**
 * The version of a wording as built into this app: what the person actually
 * read, and therefore what a consent names (ADR-010 §4). When the API has a
 * newer wording, the app asks for an update instead of recording a consent
 * for a text it never showed.
 */
export function bundledVersion(kind: ConsentKind): string {
  return CONSENT_VERSIONS[kind] ?? "";
}

const GENDER_TEXT: Record<Gender, PlainMessageKey> = {
  woman: "onboarding.gender.woman",
  man: "onboarding.gender.man",
  non_binary: "onboarding.gender.non_binary",
};
const SEEKS_TEXT: Record<Gender, PlainMessageKey> = {
  woman: "onboarding.seeks.woman",
  man: "onboarding.seeks.man",
  non_binary: "onboarding.seeks.non_binary",
};

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      variant={selected ? "default" : "outline"}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      {label}
    </Button>
  );
}

/** The consent texts exist in fi, sv and en; the pseudo-locale reads the English. */
const consentLocale = (locale: string): "fi" | "sv" | "en" =>
  locale === "fi" || locale === "sv" ? locale : "en";

/**
 * The first minutes after the bank login (#46, ADR-010): one question per
 * screen, every answer a button, the consents shown as the exact version the
 * person accepts, the research opt-in on its own. The API decides what is
 * still missing; this screen asks the next thing and leaves when nothing is.
 */
export function OnboardingScreen() {
  const { t, locale } = useT();
  const router = useRouter();
  const tap = useHapticTap();
  const { state, busy, failed, reload, step } = useOnboarding();
  const [researchOffered, setResearchOffered] = useState(false);
  const [seeks, setSeeks] = useState<Gender[]>([]);
  const [gender, setGender] = useState<Gender | null>(null);
  const [ages, setAges] = useState<{ min: string; max: string }>({ min: "", max: "" });
  // Seeks and the age window are saved together, so the API cannot tell the
  // two screens apart: the move from the first to the second is this flag.
  const [afterSeeks, setAfterSeeks] = useState(false);

  const computed: Step | null =
    state.status === "ready" ? nextStep(state.onboarding, researchOffered) : null;
  const current: Step | null =
    computed === "seeks" && afterSeeks && seeks.length > 0 ? "age" : computed;
  useEffect(() => {
    if (current === "done") router.replace("/");
  }, [current, router]);

  if (state.status === "loading") {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center p-6">
          <Text accessibilityLiveRegion="polite">{t("onboarding.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (state.status === "error" || current === null) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <Text accessibilityLiveRegion="assertive">{t("onboarding.failed")}</Text>
          <Button onPress={() => void reload()}>{t("onboarding.retry")}</Button>
        </View>
      </SafeAreaView>
    );
  }
  const { onboarding, ponds } = state;
  const ageWindow = AgeWindow.safeParse({ min: Number(ages.min), max: Number(ages.max) });
  const position = STEPS.indexOf(current) + 1;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="flex-grow gap-6 p-6"
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="h1" accessibilityRole="header">
          {t("onboarding.title")}
        </Text>
        {current !== "done" && (
          <Text variant="muted" accessibilityLiveRegion="polite">
            {t("onboarding.progress", { step: position, total: STEPS.length })}
          </Text>
        )}
        {failed && <Text accessibilityLiveRegion="assertive">{t("onboarding.failed")}</Text>}

        {current === "gender" && (
          <View className="gap-4">
            <Text variant="h2">{t("onboarding.gender.title")}</Text>
            <Text>{t("onboarding.gender.explain")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {GENDERS.map((option) => (
                <Chip
                  key={option}
                  label={t(GENDER_TEXT[option])}
                  selected={gender === option}
                  onPress={() => {
                    tap();
                    setGender(option);
                  }}
                />
              ))}
            </View>
            <Button
              disabled={busy || gender === null}
              onPress={() => {
                tap();
                if (gender) void step(() => declareGender(gender));
              }}
            >
              {t("onboarding.continue")}
            </Button>
          </View>
        )}

        {current === "seeks" && (
          <View className="gap-4">
            <Text variant="h2">{t("onboarding.seeks.title")}</Text>
            <Text>{t("onboarding.seeks.explain")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {GENDERS.map((option) => (
                <Chip
                  key={option}
                  label={t(SEEKS_TEXT[option])}
                  selected={seeks.includes(option)}
                  onPress={() => {
                    tap();
                    setSeeks((s) =>
                      s.includes(option) ? s.filter((g) => g !== option) : [...s, option],
                    );
                  }}
                />
              ))}
              <Chip
                label={t("onboarding.seeks.anyone")}
                selected={seeks.length === GENDERS.length}
                onPress={() => {
                  tap();
                  setSeeks([...GENDERS]);
                }}
              />
            </View>
            {/* Seeks and the age window are one save: this button only moves on. */}
            <Button
              disabled={seeks.length === 0}
              onPress={() => {
                tap();
                setAfterSeeks(true);
              }}
            >
              {t("onboarding.continue")}
            </Button>
          </View>
        )}

        {current === "age" && (
          <View className="gap-4">
            <Text variant="h2">{t("onboarding.age.title")}</Text>
            <Text>{t("onboarding.age.explain", { min: AGE_MIN, max: AGE_MAX })}</Text>
            <View className="flex-row gap-3">
              <View className="flex-1 gap-1">
                <Text variant="small">{t("onboarding.age.youngest")}</Text>
                <Input
                  accessibilityLabel={t("onboarding.age.youngest")}
                  keyboardType="number-pad"
                  value={ages.min}
                  onChangeText={(min) => setAges((a) => ({ ...a, min }))}
                />
              </View>
              <View className="flex-1 gap-1">
                <Text variant="small">{t("onboarding.age.oldest")}</Text>
                <Input
                  accessibilityLabel={t("onboarding.age.oldest")}
                  keyboardType="number-pad"
                  value={ages.max}
                  onChangeText={(max) => setAges((a) => ({ ...a, max }))}
                />
              </View>
            </View>
            {(ages.min || ages.max) && !ageWindow.success && (
              <Text variant="muted">
                {t("onboarding.age.invalid", { min: AGE_MIN, max: AGE_MAX })}
              </Text>
            )}
            <Button
              disabled={busy || !ageWindow.success || seeks.length === 0}
              onPress={() => {
                tap();
                if (ageWindow.success) {
                  void step(() => savePreferences({ seeks, ageWindow: ageWindow.data }));
                }
              }}
            >
              {t("onboarding.continue")}
            </Button>
          </View>
        )}

        {current === "pond" && (
          <View className="gap-4">
            <Text variant="h2">{t("onboarding.pond.title")}</Text>
            <Text>{t("onboarding.pond.explain")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {ponds.ponds.map((pond: PondSummary) => (
                <Chip
                  key={pond.id}
                  label={pond.name}
                  selected={onboarding.pond?.id === pond.id}
                  onPress={() => {
                    tap();
                    void step(() => choosePond(pond.id));
                  }}
                />
              ))}
            </View>
          </View>
        )}

        {current === "consents" && (
          <View className="gap-4">
            <Text variant="h2">{t("onboarding.consents.title")}</Text>
            <Text>{t("onboarding.consents.explain")}</Text>
            {locale !== "fi" && <Text variant="muted">{t("onboarding.consents.binding")}</Text>}
            {(["terms", "privacy"] as const).map((kind) => (
              <Card key={kind}>
                <CardHeader>
                  <CardTitle>
                    {t(kind === "terms" ? "legal.terms.title" : "legal.privacy.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="gap-2">
                  <Text>
                    {t(kind === "terms" ? "legal.terms.summary" : "legal.privacy.summary")}
                  </Text>
                  <Text variant="muted">
                    {t("onboarding.consents.version", { version: bundledVersion(kind) })}
                  </Text>
                </CardContent>
              </Card>
            ))}
            {(["terms", "privacy"] as const).some(
              (kind) => bundledVersion(kind) !== onboarding.currentVersions[kind],
            ) ? (
              <Text accessibilityLiveRegion="polite">{t("onboarding.consents.outdatedApp")}</Text>
            ) : (
              <Button
                disabled={busy}
                onPress={() => {
                  tap();
                  void step(async () => {
                    for (const kind of ["terms", "privacy"] as ConsentKind[]) {
                      await giveConsent(kind, bundledVersion(kind), consentLocale(locale));
                    }
                  });
                }}
              >
                {t("onboarding.consents.accept")}
              </Button>
            )}
          </View>
        )}

        {current === "research" && (
          <View className="gap-4">
            <Text variant="h2">{t("onboarding.research.title")}</Text>
            {locale !== "fi" && <Text variant="muted">{t("onboarding.consents.binding")}</Text>}
            <Card>
              <CardHeader>
                <CardTitle>{t("legal.research.title")}</CardTitle>
              </CardHeader>
              <CardContent className="gap-2">
                <Text>{t("legal.research.summary")}</Text>
                <Text variant="muted">
                  {t("onboarding.consents.version", { version: bundledVersion("research") })}
                </Text>
              </CardContent>
            </Card>
            <Text variant="muted">{t("onboarding.research.later")}</Text>
            {bundledVersion("research") !== onboarding.currentVersions.research ? (
              <Text accessibilityLiveRegion="polite">{t("onboarding.consents.outdatedApp")}</Text>
            ) : (
              <Button
                disabled={busy}
                onPress={() => {
                  tap();
                  setResearchOffered(true);
                  void step(() =>
                    giveConsent("research", bundledVersion("research"), consentLocale(locale)),
                  );
                }}
              >
                {t("onboarding.research.yes")}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onPress={() => {
                tap();
                setResearchOffered(true);
              }}
            >
              {t("onboarding.research.no")}
            </Button>
          </View>
        )}

        {current === "done" && <Text accessibilityLiveRegion="polite">{t("onboarding.done")}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}
