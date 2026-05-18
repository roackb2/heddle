export type AppSurfaceId = 'sessions' | 'tasks';
export type SettingsSectionId = 'general' | 'workspaces' | 'memory';

export interface NavigationItem {
  id: AppSurfaceId | SettingsSectionId;
  label: string;
  href: string;
}
