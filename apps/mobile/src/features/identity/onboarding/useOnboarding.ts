import type { OnboardingStatus, PondList } from "@kuutti/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOnboarding, fetchPonds } from "./client";

export type OnboardingState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; onboarding: OnboardingStatus; ponds: PondList };

/**
 * The onboarding status and the pond list, reloaded after every step (#46):
 * the API decides what is still missing, the screen only shows the next
 * question. A step that fails leaves the status as it was and says so.
 */
export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const [onboarding, ponds] = await Promise.all([fetchOnboarding(), fetchPonds()]);
      if (mounted.current) setState({ status: "ready", onboarding, ponds });
    } catch {
      if (mounted.current) setState({ status: "error" });
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  /** Runs one step's call, then reads the status again. */
  const step = useCallback(
    async (call: () => Promise<unknown>) => {
      setBusy(true);
      setFailed(false);
      try {
        await call();
        await reload();
      } catch {
        if (mounted.current) setFailed(true);
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [reload],
  );

  return { state, busy, failed, reload, step };
}
