import { render } from "@testing-library/react-native";
import type * as React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/features/identity";
import { LocaleProvider } from "@/lib/locale";
import { ThemeProvider } from "@/theme/ThemeProvider";

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Renders under the providers the root layout supplies: safe area, language, theme and session. */
export function renderWithTheme(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LocaleProvider>
        <ThemeProvider>
          <SessionProvider>{ui}</SessionProvider>
        </ThemeProvider>
      </LocaleProvider>
    </SafeAreaProvider>,
  );
}
