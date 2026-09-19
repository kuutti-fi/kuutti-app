import type { HealthResponse } from "@kuutti/schema";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { apiBaseUrl, fetchHealth } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

/**
 * M1 smoke screen: proves the app boots and reaches the API. Rebuilt on the UI
 * primitives in #12 and localised in #13; strings are inline until then.
 */
export function SmokeScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const dark = useColorScheme() === "dark";

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

  const colors = dark ? palette.dark : palette.light;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        Kuutti
      </Text>
      <Text style={[styles.muted, { color: colors.muted }]}>{apiBaseUrl()}</Text>

      {state.kind === "loading" && (
        <Text style={[styles.body, { color: colors.foreground }]}>Reaching the API…</Text>
      )}

      {state.kind === "ok" && (
        <View accessibilityLabel="API status">
          <Text style={[styles.body, { color: colors.foreground }]}>
            API {state.health.version}
          </Text>
          <Text style={[styles.muted, { color: colors.muted }]}>commit {state.health.commit}</Text>
          <Text style={[styles.muted, { color: colors.muted }]}>
            db {state.health.db} · migrations {state.health.migrations}
          </Text>
        </View>
      )}

      {state.kind === "error" && (
        <View accessibilityLabel="API unreachable">
          <Text style={[styles.body, { color: colors.destructive }]}>API unreachable</Text>
          <Text style={[styles.muted, { color: colors.muted }]}>{state.message}</Text>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry"
        onPress={load}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={[styles.buttonText, { color: colors.background }]}>Retry</Text>
      </Pressable>
    </View>
  );
}

const palette = {
  light: {
    background: "#FFFFFF",
    foreground: "#111827",
    muted: "#6B7280",
    primary: "#1D4ED8",
    destructive: "#B91C1C",
  },
  dark: {
    background: "#0B1220",
    foreground: "#F3F4F6",
    muted: "#9CA3AF",
    primary: "#93C5FD",
    destructive: "#FCA5A5",
  },
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  title: { fontSize: 32, fontWeight: "700" },
  body: { fontSize: 18 },
  muted: { fontSize: 14 },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 20,
    justifyContent: "center",
    borderRadius: 8,
    marginTop: 12,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
