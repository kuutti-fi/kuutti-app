import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * The OS reduce-motion setting, live (#12). Every animation and haptic in the
 * app is gated by this hook: Reanimated's own useReducedMotion reads the
 * setting once at start and misses a change made while the app runs.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduced(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/** `duration` in milliseconds, or 0 when the user asked for reduced motion. */
export function useMotionDuration(duration: number): number {
  return useReducedMotion() ? 0 : duration;
}
