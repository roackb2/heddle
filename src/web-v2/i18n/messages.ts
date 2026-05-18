import enUs from './locales/en-us.json';
import zhCn from './locales/zh-cn.json';
import zhTw from './locales/zh-tw.json';

export const messages = {
  'en-us': enUs,
  'zh-tw': zhTw satisfies typeof enUs,
  'zh-cn': zhCn satisfies typeof enUs,
};

export type Locale = keyof typeof messages;

type DotPath<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPath<T[K]>}`;
    }[keyof T & string];

export type I18nMessageKey = DotPath<typeof enUs>;

export function readMessage(locale: Locale, key: I18nMessageKey): string {
  let value: unknown = messages[locale];
  for (const segment of key.split('.')) {
    if (!value || typeof value !== 'object') {
      return key;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' ? value : key;
}
