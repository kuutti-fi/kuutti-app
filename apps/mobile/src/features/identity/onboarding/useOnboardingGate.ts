import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../session";
import { fetchOnboarding } from "./client";

export type OnboardingGate =
  | { status: "signed-out" }
  | { status: "checking" }
  /** Nothing required is missing: the home screen may show what needs a finished account. */
  | { status: "complete" }
  /** Sent to onboarding; the home screen shows nothing meanwhile. */
  | { status: "incomplete" }
  /** The status could not be read: the gate stays closed and offers a retry (#65 review). */
  | { status: "unknown" };

/**
 * The home screen's gate (#46): a signed-in account that has not finished
 * onboarding is sent to it, and until the status has been read and says
 * complete, the screen shows none of what needs a finished account. A
 * status that cannot be read keeps the gate closed rather than open.
 */
export function useOnboardingGate(): OnboardingGate & { retry: () => void } {
  const session = useSession();
  const router = useRouter();
  const signedIn = session.status === "signed-in";
  const [gate, setGate] = useState<OnboardingGate>({ status: "signed-out" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!signedIn) {
      setGate({ status: "signed-out" });
      return;
    }
    let live = true;
    setGate({ status: "checking" });
    fetchOnboarding()
      .then((status) => {
        if (!live) return;
        if (status.state === "registered" || !status.complete) {
          setGate({ status: "incomplete" });
          router.replace("/onboarding");
        } else {
          setGate({ status: "complete" });
        }
      })
      .catch(() => {
        if (live) setGate({ status: "unknown" });
      });
    return () => {
      live = false;
    };
  }, [signedIn, router, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...gate, retry };
}
