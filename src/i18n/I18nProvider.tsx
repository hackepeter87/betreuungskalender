import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  defaultLocale,
  localeMetadata,
  supportedLocales,
  translate,
  type AppLocale,
  type TranslationKey
} from "./resources";

const LOCALE_PREFERENCE_KEY = "betreuungskalender:ui:locale:v1";

function readLocalePreference(): AppLocale {
  const stored = window.localStorage.getItem(LOCALE_PREFERENCE_KEY);
  return supportedLocales.includes(stored as AppLocale)
    ? (stored as AppLocale)
    : defaultLocale;
}

interface I18nValue {
  locale: AppLocale;
  intlLocale: string;
  setLocale: (locale: AppLocale) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(readLocalePreference);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      intlLocale: localeMetadata[locale].intlLocale,
      setLocale: (nextLocale) => {
        window.localStorage.setItem(LOCALE_PREFERENCE_KEY, nextLocale);
        setLocaleState(nextLocale);
      },
      t: (key) => translate(locale, key)
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
