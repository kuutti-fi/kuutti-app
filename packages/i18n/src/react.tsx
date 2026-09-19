import type { i18n } from "i18next";
import type * as React from "react";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { type CreateI18nOptions, createI18n, type TFunction } from "./instance.ts";
import type { AnyLocale } from "./locales.ts";

/** createI18n with the React binding, for the app and the admin panel. */
export function createReactI18n(options: Omit<CreateI18nOptions, "plugins">): i18n {
  return createI18n({ ...options, plugins: [initReactI18next] });
}

export function I18nProvider({ i18n, children }: { i18n: i18n; children: React.ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** The typed t() of the nearest provider; re-renders when the language changes. */
export function useT(): { t: TFunction; locale: AnyLocale } {
  const { t, i18n } = useTranslation();
  return { t: t as unknown as TFunction, locale: i18n.language as AnyLocale };
}
