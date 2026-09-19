import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import { Platform } from "react-native";
import { useReducedMotion } from "./useReducedMotion";

/**
 * A light tap for a completed action. Silent when reduce-motion is on (#12:
 * people who switch motion off rarely want the phone to buzz instead) and on
 * web, where there is nothing to buzz.
 */
export function useHapticTap(): () => void {
  const reduced = useReducedMotion();
  return useCallback(() => {
    if (reduced || Platform.OS === "web") return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [reduced]);
}
