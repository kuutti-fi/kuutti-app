import { createReactI18n } from "@kuutti/i18n/react";

// The panel is English only by decision (TD-17). It still reads its text from
// messages.yaml, so the keys exist the day that changes.
export const i18n = createReactI18n({ locale: "en" });
