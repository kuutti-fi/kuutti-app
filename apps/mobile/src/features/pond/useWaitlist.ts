import type { WaitlistPond } from "@kuutti/schema";
import { useCallback, useEffect, useState } from "react";
import { fetchWaitlist } from "./client";

export type WaitlistState =
  | { status: "loading" }
  /** What the counter says of the pond; `figures` is null when the list does not name the pond. */
  | { status: "ready"; k: number; figures: WaitlistPond | null }
  | { status: "failed" };

/** What the public counter says of one pond (#54). */
export function useWaitlist(pondId: string): WaitlistState & { retry: () => void } {
  const [state, setState] = useState<WaitlistState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchWaitlist()
      .then((waitlist) => {
        if (!live) return;
        const figures = waitlist.ponds.find((entry) => entry.pond.id === pondId) ?? null;
        setState({ status: "ready", k: waitlist.k, figures });
      })
      .catch(() => {
        if (live) setState({ status: "failed" });
      });
    return () => {
      live = false;
    };
  }, [pondId, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
