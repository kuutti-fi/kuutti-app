import { useRouter } from "expo-router";
import { useEffect } from "react";
import { useSession } from "../session";
import { fetchOnboarding } from "./client";

/**
 * The home screen's gate (#46): a signed-in account that has not finished
 * onboarding is sent to it. A status that cannot be read changes nothing;
 * the API refuses what an unfinished account may not do anyway.
 */
export function useOnboardingGate(): void {
  const session = useSession();
  const router = useRouter();
  const signedIn = session.status === "signed-in";
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchOnboarding()
      .then((status) => {
        if (live && (status.state === "registered" || !status.complete)) {
          router.replace("/onboarding");
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [signedIn, router]);
}
