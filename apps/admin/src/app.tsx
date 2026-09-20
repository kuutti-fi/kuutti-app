import { useT } from "@kuutti/i18n/react";
import mark from "./logo-mark.png";
import { SourceOffer } from "./source-offer.tsx";

// Placeholder. Screens (report queue, photo queue, config editor) arrive with M4.
// English only by decision (TD-17); the component library choice is open (rules/admin.md).
export function App() {
  const { t } = useT();
  return (
    <>
      <main>
        {/* The mark is decorative: the heading right under it carries the name. */}
        <img src={mark} alt="" width={64} height={64} />
        <h1>{t("admin.title")}</h1>
        <p>{t("admin.empty")}</p>
      </main>
      <SourceOffer />
    </>
  );
}
