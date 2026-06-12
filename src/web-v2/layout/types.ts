import type { I18nMessageKey } from '@web/i18n/messages';

export type AppSurfaceId = 'sessions' | 'tasks';
export type SettingsSectionId = 'general' | 'workspaces' | 'browserAutomation' | 'agents' | 'skills' | 'mcp' | 'memory';

export interface NavigationItem {
  id: AppSurfaceId | SettingsSectionId;
  labelKey: I18nMessageKey;
  href: string;
}
