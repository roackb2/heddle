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
const SESSION_ROUTE_PREFIX = '/sessions/';
const TASK_ROUTE_PREFIX = '/tasks/';

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

export function routeForSession(sessionId: string): string {
  return `${DEFAULT_APP_ROUTE}/${encodeURIComponent(sessionId)}`;
}

export function routeForTask(taskId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}`;
}

export function routeForTaskRun(taskId: string, runId: string): string {
  return `${routeForTask(taskId)}/runs/${encodeURIComponent(runId)}`;
}

export function resolveRouteSessionId(pathname: string): string | undefined {
  if (!pathname.startsWith(SESSION_ROUTE_PREFIX)) {
    return undefined;
  }

  const [encodedSessionId] = pathname.slice(SESSION_ROUTE_PREFIX.length).split('/');
  if (!encodedSessionId) {
    return undefined;
  }

  try {
    return decodeURIComponent(encodedSessionId);
  } catch {
    return undefined;
  }
}

export function resolveRouteTaskSelection(pathname: string): { taskId?: string; runId?: string } {
  if (!pathname.startsWith(TASK_ROUTE_PREFIX)) {
    return {};
  }

  const [encodedTaskId, runSegment, encodedRunId] = pathname.slice(TASK_ROUTE_PREFIX.length).split('/');
  const taskId = decodePathSegment(encodedTaskId);
  if (!taskId) {
    return {};
  }

  return {
    taskId,
    runId: runSegment === 'runs' ? decodePathSegment(encodedRunId) : undefined,
  };
}

function decodePathSegment(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
