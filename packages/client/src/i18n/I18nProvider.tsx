import { createContext, type ReactNode, useContext, useMemo } from "react";
import { createTranslator, FALLBACK_LOCALE, type Translate, type UiLocale } from "./i18n";

interface I18nValue {
  locale: UiLocale;
  t: Translate;
}

const I18nContext = createContext<I18nValue>({ locale: FALLBACK_LOCALE, t: createTranslator(FALLBACK_LOCALE) });

/** Provides the UI language to everything below it (see `useI18n`). */
export function I18nProvider({ locale, children }: { locale: UiLocale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: createTranslator(locale) }), [locale]);
  return (
    <I18nContext.Provider value={value}>
      <div lang={locale} style={{ display: "contents" }}>
        {children}
      </div>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
