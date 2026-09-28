import type { GateResponse } from "@kuutti/schema";
import { useCallback, useEffect, useState } from "react";
import { fetchGate } from "./client";

export type GateView =
  | { status: "loading" }
  | { status: "ready"; gate: GateResponse }
  | { status: "failed" };

/** Where the person stands at the pond gate (#94). */
export function useGate(): GateView & { retry: () => void } {
  const [state, setState] = useState<GateView>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchGate()
      .then((gate) => {
        if (live) setState({ status: "ready", gate });
      })
      .catch(() => {
        if (live) setState({ status: "failed" });
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
