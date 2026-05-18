import type { I18nMessageKey, Locale } from './messages';

export interface LocaleOption {
  labelKey: I18nMessageKey;
  locale: Locale;
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { locale: 'en-us', labelKey: 'language.en-us' },
  { locale: 'zh-tw', labelKey: 'language.zh-tw' },
  { locale: 'zh-cn', labelKey: 'language.zh-cn' },
];
