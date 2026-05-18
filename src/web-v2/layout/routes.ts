import type { I18nMessageKey } from '@web/i18n';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';

export interface AppRoute {
  id: AppSurfaceId;
  labelKey: I18nMessageKey;
  href: string;
}

export interface SettingsRoute {
  id: SettingsSectionId;
  labelKey: I18nMessageKey;
  href: string;
}

// Route config is the source of truth for both router entries and sidebar
// navigation, so v2 does not grow separate page and nav vocabularies.
export const APP_ROUTES = [
  { id: 'sessions', labelKey: 'surface.sessions', href: '/sessions' },
  { id: 'tasks', labelKey: 'surface.tasks', href: '/tasks' },
] as const satisfies readonly AppRoute[];

export const SETTINGS_ROUTES = [
  { id: 'general', labelKey: 'settings.general', href: '/settings/general' },
  { id: 'workspaces', labelKey: 'settings.workspaces', href: '/settings/workspaces' },
  { id: 'memory', labelKey: 'settings.memory', href: '/settings/memory' },
] as const satisfies readonly SettingsRoute[];

export const DEFAULT_APP_ROUTE = APP_ROUTES[0].href;
export const DEFAULT_SETTINGS_ROUTE = SETTINGS_ROUTES[0].href;

export function resolveAppSurface(pathname: string): AppSurfaceId {
  return APP_ROUTES.find((route) => pathname.startsWith(route.href))?.id ?? APP_ROUTES[0].id;
}

export function resolveSettingsSection(pathname: string): SettingsSectionId {
  return SETTINGS_ROUTES.find((route) => pathname.startsWith(route.href))?.id ?? SETTINGS_ROUTES[0].id;
}

export function routeForAppSurface(id: AppSurfaceId): string {
  return APP_ROUTES.find((route) => route.id === id)?.href ?? DEFAULT_APP_ROUTE;
}

export function routeForSettingsSection(id: SettingsSectionId): string {
  return SETTINGS_ROUTES.find((route) => route.id === id)?.href ?? DEFAULT_SETTINGS_ROUTE;
}
