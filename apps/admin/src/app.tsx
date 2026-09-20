import { useT } from "@kuutti/i18n/react";
import { SourceOffer } from "./source-offer.tsx";

// Placeholder. Screens (report queue, photo queue, config editor) arrive with M4.
// English only by decision (TD-17); the component library choice is open (rules/admin.md).
export function App() {
  const { t } = useT();
  return (
    <>
      <main>
        <h1>{t("admin.title")}</h1>
        <p>{t("admin.empty")}</p>
      </main>
      <SourceOffer />
    </>
  );
}
