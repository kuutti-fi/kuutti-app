import { PortalHost } from "@rn-primitives/portal";
import { useColorScheme } from "nativewind";
import * as React from "react";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  useColorScheme as useSystemColorScheme,
} from "react-native";
import { cn } from "@/lib/utils";
import { useMotionDuration } from "./useReducedMotion";

export type SchemePreference = "system" | "light" | "dark";

type Theme = {
  /** What is on screen now. */
  scheme: "light" | "dark";
  /** What was asked for; "system" follows the OS (the default). */
  preference: SchemePreference;
  setPreference: (preference: SchemePreference) => void;
  highContrast: boolean;
  setHighContrast: (on: boolean) => void;
};

const ThemeContext = React.createContext<Theme | null>(null);

const THEME_FADE_MS = 150;

/** The OS asks for more contrast: "Increase Contrast" on iOS, high-contrast text on Android. */
function useSystemHighContrast(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    if (Platform.OS === "web") return;
    const [read, event] =
      Platform.OS === "ios"
        ? ([AccessibilityInfo.isDarkerSystemColorsEnabled, "darkerSystemColorsChanged"] as const)
        : ([AccessibilityInfo.isHighTextContrastEnabled, "highTextContrastChanged"] as const);
    let mounted = true;
    void read().then((enabled) => {
      if (mounted) setOn(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(event, setOn);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return on;
}

/**
 * Applies the token sets of tokens.css (#12, TD-9). Light and dark follow the
 * system through NativeWind's .dark; high contrast is a second token set that
 * this root view hands down as CSS variables, following the OS setting until
 * the user chooses. The portal host sits inside the root view so dialogs
 * inherit the same tokens. A change of theme fades in briefly, instantly under
 * reduce-motion.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [preference, setPreferenceState] = React.useState<SchemePreference>("system");
  const systemHighContrast = useSystemHighContrast();
  const [chosenHighContrast, setChosenHighContrast] = React.useState<boolean | null>(null);
  const highContrast = chosenHighContrast ?? systemHighContrast;
  const scheme = colorScheme === "dark" ? "dark" : "light";

  // Native: NativeWind resolves "system" itself. Web: its class mode adds .dark
  // only for an explicit "dark", so "system" is resolved here from the media
  // query and kept in step with it.
  const system = useSystemColorScheme() === "dark" ? "dark" : "light";
  React.useEffect(() => {
    if (Platform.OS === "web") setColorScheme(preference === "system" ? system : preference);
  }, [preference, system, setColorScheme]);

  const setPreference = React.useCallback(
    (next: SchemePreference) => {
      setPreferenceState(next);
      if (Platform.OS !== "web") setColorScheme(next);
    },
    [setColorScheme],
  );

  // Web dialogs are portalled to <body>, outside the root view below, so the
  // high-contrast set also goes on <body> there (not on <html>, where
  // .dark:root would outrank it). Native portals render inside the PortalHost
  // and inherit from the root view.
  const contrastClass = highContrast
    ? scheme === "dark"
      ? "high-contrast-dark"
      : "high-contrast"
    : undefined;
  React.useEffect(() => {
    if (Platform.OS !== "web" || !contrastClass) return;
    const body = globalThis.document?.body;
    body?.classList.add(contrastClass);
    return () => body?.classList.remove(contrastClass);
  }, [contrastClass]);

  const duration = useMotionDuration(THEME_FADE_MS);
  const opacity = React.useRef(new Animated.Value(1)).current;
  const appearance = `${scheme}:${highContrast}`;
  const shown = React.useRef(appearance);
  React.useEffect(() => {
    if (shown.current === appearance) return;
    shown.current = appearance;
    if (duration === 0) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0.4);
    Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }).start();
  }, [appearance, duration, opacity]);

  const theme = React.useMemo<Theme>(
    () => ({
      scheme,
      preference,
      setPreference,
      highContrast,
      setHighContrast: setChosenHighContrast,
    }),
    [scheme, preference, setPreference, highContrast],
  );

  return (
    <ThemeContext.Provider value={theme}>
      <Animated.View style={{ flex: 1, opacity }} className={cn("bg-background", contrastClass)}>
        {children}
        <PortalHost />
      </Animated.View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = React.useContext(ThemeContext);
  if (!theme) throw new Error("useTheme needs a ThemeProvider above it");
  return theme;
}
