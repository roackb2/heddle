import type { NavigationItem } from './types';

export const APP_NAV_ITEMS: NavigationItem[] = [
  { id: 'sessions', label: 'Sessions', href: '#sessions' },
  { id: 'tasks', label: 'Tasks', href: '#tasks' },
];

export const SETTINGS_NAV_ITEMS: NavigationItem[] = [
  { id: 'general', label: 'General', href: '#settings-general' },
  { id: 'workspaces', label: 'Workspace Management', href: '#settings-workspaces' },
  { id: 'memory', label: 'Memory Status', href: '#settings-memory' },
];
