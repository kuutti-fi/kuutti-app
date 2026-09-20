import { useT } from "@kuutti/i18n/react";
import { HealthResponse } from "@kuutti/schema";
import { useEffect, useState } from "react";

/** Set at build time for a deployed panel; the local API otherwise. */
const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

type State = { kind: "loading" } | { kind: "ok"; health: HealthResponse } | { kind: "unknown" };

/**
 * The source-code offer of AGPL-3.0 section 13 for the panel's users (#16):
 * the address the running API names in /health, with its commit. Parsed with
 * the shared contract, which admits https addresses only.
 */
export function SourceOffer() {
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then(async (response) => HealthResponse.parse(await response.json()))
      .then((health) => setState({ kind: "ok", health }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "unknown" });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") return <footer aria-busy="true" />;
  if (state.kind === "unknown") return <footer>{t("admin.source.unavailable")}</footer>;
  return (
    <footer>
      {t("admin.source.offer", { commit: state.health.commit })}{" "}
      <a href={state.health.source} rel="noreferrer noopener" target="_blank">
        {state.health.source}
      </a>
    </footer>
  );
}
