import { LOCALE_NAMES, type PlainMessageKey } from "@kuutti/i18n";
import * as Sentry from "@sentry/react-native";
import Settings from "lucide-react-native/icons/settings";
import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useSession } from "@/features/identity";
import {
  LOCALE_FLAGS,
  type LocalePreference,
  OFFERED_LOCALES,
  useLocaleSettings,
  useT,
} from "@/lib/locale";
import { type SchemePreference, useTheme } from "@/theme/ThemeProvider";

const SCHEMES: ReadonlyArray<{ value: SchemePreference; label: PlainMessageKey }> = [
  { value: "system", label: "settings.theme.system" },
  { value: "light", label: "settings.theme.light" },
  { value: "dark", label: "settings.theme.dark" },
];

/**
 * One option of a group. The chosen one is marked in text too, never by colour
 * alone. A flag, when given, is decoration in front of the text: the accessible
 * name is the text alone, so a screen reader never announces "flag: Åland".
 */
function Choice(props: { label: string; flag?: string; chosen: boolean; onPress: () => void }) {
  const { t } = useT();
  const name = props.chosen ? t("settings.selected", { option: props.label }) : props.label;
  return (
    <Button
      variant={props.chosen ? "default" : "outline"}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.chosen }}
      // react-native-web reads the ARIA prop, not accessibilityState.
      aria-checked={props.chosen}
      accessibilityLabel={name}
      className="grow"
      onPress={props.onPress}
    >
      {props.flag ? `${props.flag} ${name}` : name}
    </Button>
  );
}

/**
 * Theme, high contrast and language for builds that are not production (#12,
 * #13): how every token set and every locale, en-XA included, is looked at on
 * a device. The language choice is the in-app override that beats the phone's.
 */
export function DevSettings() {
  const { t } = useT();
  const theme = useTheme();
  const locale = useLocaleSettings();
  const session = useSession();
  const [errorSent, setErrorSent] = useState(false);
  const languages: ReadonlyArray<{ value: LocalePreference; label: string; flag?: string }> = [
    { value: "system", label: t("settings.language.system") },
    // A language is listed under its own name, whatever the app's language is.
    ...OFFERED_LOCALES.map((value) => ({
      value,
      label: LOCALE_NAMES[value],
      flag: LOCALE_FLAGS[value],
    })),
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" accessibilityLabel={t("settings.open")}>
          <Icon as={Settings} />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("settings.close")}>
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.devOnly")}</DialogDescription>
        </DialogHeader>

        <View className="gap-2">
          <Text variant="small">{t("settings.theme.label")}</Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t("settings.theme.label")}
            className="flex-row flex-wrap gap-2"
          >
            {SCHEMES.map(({ value, label }) => (
              <Choice
                key={value}
                label={t(label)}
                chosen={theme.preference === value}
                onPress={() => theme.setPreference(value)}
              />
            ))}
          </View>
        </View>

        <View className="flex-row items-center justify-between gap-4">
          <Label
            nativeID="high-contrast-label"
            onPress={() => theme.setHighContrast(!theme.highContrast)}
          >
            {t("settings.highContrast")}
          </Label>
          <Switch
            accessibilityLabel={t("settings.highContrast")}
            checked={theme.highContrast}
            onCheckedChange={theme.setHighContrast}
          />
        </View>

        <View className="gap-2">
          <Text variant="small">{t("settings.language.label")}</Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t("settings.language.label")}
            className="flex-row flex-wrap gap-2"
          >
            {languages.map(({ value, label, flag }) => (
              <Choice
                key={value}
                label={label}
                flag={flag}
                chosen={locale.preference === value}
                onPress={() => locale.setPreference(value)}
              />
            ))}
          </View>
        </View>

        {/* This device's session (#35): log out here, or everywhere, which is
            the recovery for a lost phone. Errors are swallowed: the local
            session is cleared either way, and the row expires on its own. */}
        <View className="gap-2">
          <Text variant="small">{t("settings.session.label")}</Text>
          {session.status === "signed-in" ? (
            <View className="flex-row flex-wrap gap-2">
              <Button
                variant="outline"
                className="grow"
                accessibilityLabel={t("settings.logout")}
                onPress={() => void session.signOut()}
              >
                <Text>{t("settings.logout")}</Text>
              </Button>
              <Button
                variant="destructive"
                className="grow"
                accessibilityLabel={t("settings.logoutAll")}
                onPress={() => void session.signOutEverywhere().catch(() => undefined)}
              >
                <Text>{t("settings.logoutAll")}</Text>
              </Button>
            </View>
          ) : (
            <Text variant="muted">{t("settings.session.none")}</Text>
          )}
        </View>

        {/* Proves error reporting end to end (#11): a real JS error with a stack
            for Sentry to symbolicate. A no-op in a build without a DSN. */}
        <View className="gap-2">
          <Button
            variant="outline"
            onPress={() => {
              Sentry.captureException(new Error("Sentry test from the settings sheet"));
              setErrorSent(true);
            }}
          >
            {t("settings.errorTest.send")}
          </Button>
          {errorSent && <Text variant="muted">{t("settings.errorTest.sent")}</Text>}
        </View>
      </DialogContent>
    </Dialog>
  );
}
