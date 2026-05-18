import type { NavigationItem } from './types';

export const APP_NAV_ITEMS: NavigationItem[] = [
  { id: 'sessions', labelKey: 'surface.sessions', href: '#sessions' },
  { id: 'tasks', labelKey: 'surface.tasks', href: '#tasks' },
];

export const SETTINGS_NAV_ITEMS: NavigationItem[] = [
  { id: 'general', labelKey: 'settings.general', href: '#settings-general' },
  { id: 'workspaces', labelKey: 'settings.workspaces', href: '#settings-workspaces' },
  { id: 'memory', labelKey: 'settings.memory', href: '#settings-memory' },
];
