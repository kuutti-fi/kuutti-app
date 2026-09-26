import type { PlainMessageKey } from "@kuutti/i18n";
import {
  BIO_MAX,
  BIO_MIN_FOR_COMPLETENESS,
  BIO_PRESETS,
  DISPLAY_NAME_MAX,
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  PROMPT_ANSWER_MAX,
  PROMPT_KEYS,
  PROMPTS_MAX,
  type ProfileFieldKey,
  type ProfileFields,
} from "@kuutti/schema";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";
import { completenessText, fieldLabelKey, optionKey, presetKey, promptKey } from "./keys";
import { type ProfileNotice, useProfile } from "./useProfile";

/** The API's refusals the screen has its own words for; anything else is the generic line. */
const ERROR_TEXT: ReadonlyMap<string, PlainMessageKey> = new Map([
  ["text_contact_details", "profile.error.text_contact_details"],
]);

function noticeText(notice: NonNullable<ProfileNotice>, t: ReturnType<typeof useT>["t"]): string {
  if (notice.kind === "saved") return t("profile.saved");
  return t(ERROR_TEXT.get(notice.code ?? "") ?? "profile.error.generic");
}

/** One choice: a button that says whether it is chosen, never a colour alone. */
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

/**
 * The profile as the person writes it (#47, ADR-009): a name, a bio or a
 * placeholder line, the fields of the registry as choices, up to three
 * prompts with short answers, and the checklist of what the card still
 * needs. Every decision is a button; every control carries its label
 * (CLAUDE.md Accessibility).
 */
export function ProfileScreen() {
  const { t } = useT();
  const router = useRouter();
  const tap = useHapticTap();
  const profile = useProfile();
  const { draft, update } = profile;

  const setField = (key: ProfileFieldKey, value: unknown) => {
    const fields: Record<string, unknown> = { ...draft.fields };
    if (value === undefined) delete fields[key];
    else fields[key] = value;
    update({ fields: fields as ProfileFields });
  };
  const chosenPrompts = new Set(draft.prompts.map((p) => p.key));

  if (profile.status === "loading") {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center p-6">
          <Text accessibilityLiveRegion="polite">{t("profile.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (profile.status === "error") {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <Text accessibilityLiveRegion="assertive">{t("profile.failed")}</Text>
          <Button onPress={() => void profile.reload()}>{t("profile.retry")}</Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="flex-grow gap-6 p-6"
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="h1" accessibilityRole="header">
          {t("profile.title")}
        </Text>
        <Text>{t("profile.explain")}</Text>

        {profile.completeness && (
          <Card>
            <CardHeader>
              <CardTitle>{t("profile.completeness.title")}</CardTitle>
              {profile.completeness.complete && (
                <CardDescription>{t("profile.completeness.complete")}</CardDescription>
              )}
            </CardHeader>
            {!profile.completeness.complete && (
              <CardContent className="gap-1">
                {profile.completeness.missing.map((item) => (
                  <Text key={item}>{completenessText(t, item)}</Text>
                ))}
              </CardContent>
            )}
          </Card>
        )}

        <View className="gap-2">
          <Text variant="small">{t("profile.displayName.label")}</Text>
          <Input
            accessibilityLabel={t("profile.displayName.label")}
            value={draft.displayName}
            maxLength={DISPLAY_NAME_MAX}
            autoCapitalize="words"
            onChangeText={(displayName) => update({ displayName })}
          />
          <Text variant="muted">{t("profile.displayName.hint", { max: DISPLAY_NAME_MAX })}</Text>
        </View>

        <View className="gap-2">
          <Text variant="small">{t("profile.bio.label")}</Text>
          <Input
            accessibilityLabel={t("profile.bio.label")}
            value={draft.bio ?? ""}
            maxLength={BIO_MAX}
            multiline
            numberOfLines={4}
            onChangeText={(text) =>
              update({
                bio: text.length > 0 ? text : null,
                bioPreset: text.length > 0 ? null : draft.bioPreset,
              })
            }
          />
          <Text variant="muted">{t("profile.bio.hint", { min: BIO_MIN_FOR_COMPLETENESS })}</Text>
          <Text variant="small">{t("profile.bio.orPreset")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {BIO_PRESETS.map((preset) => (
              <Chip
                key={preset}
                label={t(presetKey(preset))}
                selected={draft.bioPreset === preset}
                onPress={() => {
                  tap();
                  update(
                    draft.bioPreset === preset
                      ? { bioPreset: null }
                      : { bioPreset: preset, bio: null },
                  );
                }}
              />
            ))}
          </View>
        </View>

        {PROFILE_FIELD_KEYS.map((key) => {
          const spec = PROFILE_FIELDS[key];
          const value = (draft.fields as Record<string, unknown>)[key];
          return (
            <View key={key} className="gap-2">
              <Text variant="small">{t(fieldLabelKey(key))}</Text>
              {spec.kind === "text" && (
                <>
                  <Input
                    accessibilityLabel={t(fieldLabelKey(key))}
                    value={typeof value === "string" ? value : ""}
                    maxLength={spec.maxLength}
                    onChangeText={(text) => setField(key, text.length > 0 ? text : undefined)}
                  />
                  <Text variant="muted">{t("profile.campus.hint", { max: spec.maxLength })}</Text>
                </>
              )}
              {spec.kind !== "text" && (
                <View className="flex-row flex-wrap gap-2">
                  {spec.options.map((option) => {
                    const selected =
                      spec.kind === "multi"
                        ? Array.isArray(value) && value.includes(option)
                        : value === option;
                    return (
                      <Chip
                        key={option}
                        label={t(optionKey(key, option))}
                        selected={selected}
                        onPress={() => {
                          tap();
                          if (spec.kind === "multi") {
                            const current = Array.isArray(value) ? (value as string[]) : [];
                            const next = selected
                              ? current.filter((v) => v !== option)
                              : current.length < spec.max
                                ? [...current, option]
                                : current;
                            setField(key, next.length > 0 ? next : undefined);
                          } else {
                            setField(key, selected ? undefined : option);
                          }
                        }}
                      />
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        <View className="gap-3">
          <Text variant="small">{t("profile.prompts.label")}</Text>
          <Text variant="muted">{t("profile.prompts.hint", { max: PROMPTS_MAX })}</Text>
          {draft.prompts.map((prompt) => {
            const question = t(promptKey(prompt.key));
            return (
              <View key={prompt.key} className="gap-2">
                <Text>{question}</Text>
                <Input
                  accessibilityLabel={t("profile.prompts.answer", { prompt: question })}
                  value={prompt.answer}
                  maxLength={PROMPT_ANSWER_MAX}
                  multiline
                  onChangeText={(answer) =>
                    update({
                      prompts: draft.prompts.map((p) =>
                        p.key === prompt.key ? { ...p, answer } : p,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  accessibilityLabel={t("profile.prompts.remove", { prompt: question })}
                  onPress={() => {
                    tap();
                    update({ prompts: draft.prompts.filter((p) => p.key !== prompt.key) });
                  }}
                >
                  <Text>{t("profile.prompts.removeButton")}</Text>
                </Button>
              </View>
            );
          })}
          {draft.prompts.length < PROMPTS_MAX && (
            <View className="gap-2">
              <Text variant="small">{t("profile.prompts.pick")}</Text>
              <View className="flex-row flex-wrap gap-2">
                {PROMPT_KEYS.filter((key) => !chosenPrompts.has(key)).map((key) => (
                  <Chip
                    key={key}
                    label={t(promptKey(key))}
                    selected={false}
                    onPress={() => {
                      tap();
                      update({ prompts: [...draft.prompts, { key, answer: "" }] });
                    }}
                  />
                ))}
              </View>
            </View>
          )}
        </View>

        {profile.notice && (
          <Text accessibilityLiveRegion="assertive">{noticeText(profile.notice, t)}</Text>
        )}
        {profile.saving && <Text accessibilityLiveRegion="polite">{t("profile.saving")}</Text>}
        <Button
          disabled={profile.saving}
          onPress={() => {
            tap();
            void profile.save();
          }}
        >
          {t("profile.save")}
        </Button>
        <Button
          variant="outline"
          onPress={() => {
            tap();
            router.push("/profile/card");
          }}
        >
          {t("profile.card.open")}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
