import enUs from './locales/en-us.json';
import zhCn from './locales/zh-cn.json';
import zhTw from './locales/zh-tw.json';

export const messages = {
  'en-us': enUs,
  'zh-tw': zhTw satisfies typeof enUs,
  'zh-cn': zhCn satisfies typeof enUs,
};

export type Locale = keyof typeof messages;
export type I18nMessageKey = keyof typeof enUs;
