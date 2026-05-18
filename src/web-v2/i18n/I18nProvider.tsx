import { createContext, useMemo, useState, type PropsWithChildren } from 'react';
import { messages, type I18nMessageKey, type Locale } from './messages';

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
  const [locale, setLocale] = useState<Locale>(initialLocale);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key) => messages[locale][key],
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
