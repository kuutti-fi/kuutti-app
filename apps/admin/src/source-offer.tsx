import { useT } from "@kuutti/i18n/react";
import { HealthResponse } from "@kuutti/schema";
import { useEffect, useState } from "react";

/**
 * Set at build time for a deployed panel. Only a development server falls back
 * to the local API: a production build without the variable asks nobody, so
 * this constant can never send a moderator's browser to localhost.
 */
export function apiUrl(env: { VITE_API_URL?: string; PROD: boolean }): string | undefined {
  return env.VITE_API_URL ?? (env.PROD ? undefined : "http://localhost:3000");
}

const API_URL = apiUrl(import.meta.env);

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
    if (API_URL === undefined) {
      setState({ kind: "unknown" });
      return;
    }
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
