import { createContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { readMessage, type I18nMessageKey, type Locale } from './messages';

const LOCALE_STORAGE_KEY = 'heddle.web-v2.locale';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: I18nMessageKey) => string;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

interface I18nProviderProps {
  initialLocale?: Locale;
}

// I18nProvider owns the tiny v2 client dictionary until the browser surface
// needs route-level locale loading or persisted user language settings.
export function I18nProvider({ children, initialLocale = 'en-us' }: PropsWithChildren<I18nProviderProps>) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === 'undefined') {
      return initialLocale;
    }
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === 'en-us' || stored === 'zh-tw' || stored === 'zh-cn' ? stored : initialLocale;
  });

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key) => readMessage(locale, key),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
