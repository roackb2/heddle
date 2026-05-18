import type { I18nMessageKey, Locale } from './messages';

export interface LocaleOption {
  labelKey: I18nMessageKey;
  locale: Locale;
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { locale: 'en-us', labelKey: 'language.enUs' },
  { locale: 'zh-tw', labelKey: 'language.zhTw' },
  { locale: 'zh-cn', labelKey: 'language.zhCn' },
];
