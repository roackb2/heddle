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
  { id: 'browserAutomation', labelKey: 'settings.browserAutomation', href: '/settings/browser-automation' },
  { id: 'agents', labelKey: 'settings.agents', href: '/settings/agents' },
  { id: 'skills', labelKey: 'settings.skills', href: '/settings/skills' },
  { id: 'mcp', labelKey: 'settings.mcp', href: '/settings/mcp' },
  { id: 'memory', labelKey: 'settings.memory', href: '/settings/memory' },
] as const satisfies readonly SettingsRoute[];

export const DEFAULT_APP_ROUTE = APP_ROUTES[0].href;
export const DEFAULT_SETTINGS_ROUTE = SETTINGS_ROUTES[0].href;
const SESSION_ROUTE_PREFIX = '/sessions/';
const TASK_ROUTE_PREFIX = '/tasks/';
const WORKSPACE_ROUTE_PREFIX = '/workspaces/';

export function resolveAppSurface(pathname: string): AppSurfaceId {
  const routePath = workspaceScopedPath(pathname);
  return APP_ROUTES.find((route) => routePath.startsWith(route.href))?.id ?? APP_ROUTES[0].id;
}

export function resolveSettingsSection(pathname: string): SettingsSectionId {
  const routePath = workspaceScopedPath(pathname);
  return SETTINGS_ROUTES.find((route) => routePath.startsWith(route.href))?.id ?? SETTINGS_ROUTES[0].id;
}

export function isSettingsRoute(pathname: string): boolean {
  return workspaceScopedPath(pathname).startsWith('/settings');
}

export function routeForAppSurface(id: AppSurfaceId, workspaceId?: string): string {
  const legacyHref = APP_ROUTES.find((route) => route.id === id)?.href ?? DEFAULT_APP_ROUTE;
  if (!workspaceId) {
    return legacyHref;
  }

  return `/workspaces/${encodeURIComponent(workspaceId)}${legacyHref}`;
}

export function routeForSettingsSection(id: SettingsSectionId, workspaceId?: string): string {
  const legacyHref = SETTINGS_ROUTES.find((route) => route.id === id)?.href ?? DEFAULT_SETTINGS_ROUTE;
  if (!workspaceId) {
    return legacyHref;
  }

  return `/workspaces/${encodeURIComponent(workspaceId)}${legacyHref}`;
}

export function routeForSession(workspaceId: string | undefined, sessionId: string): string {
  return `${routeForAppSurface('sessions', workspaceId)}/${encodeURIComponent(sessionId)}`;
}

export function routeForTask(workspaceId: string | undefined, taskId: string): string {
  return `${routeForAppSurface('tasks', workspaceId)}/${encodeURIComponent(taskId)}`;
}

export function routeForTaskRun(workspaceId: string | undefined, taskId: string, runId: string): string {
  return `${routeForTask(workspaceId, taskId)}/runs/${encodeURIComponent(runId)}`;
}

export function resolveRouteWorkspaceId(pathname: string): string | undefined {
  if (!pathname.startsWith(WORKSPACE_ROUTE_PREFIX)) {
    return undefined;
  }

  const [encodedWorkspaceId] = pathname.slice(WORKSPACE_ROUTE_PREFIX.length).split('/');
  return decodePathSegment(encodedWorkspaceId);
}

export function resolveRouteSessionId(pathname: string): string | undefined {
  const sessionPath = workspaceScopedPath(pathname);
  if (!sessionPath.startsWith(SESSION_ROUTE_PREFIX)) {
    return undefined;
  }

  const [encodedSessionId] = sessionPath.slice(SESSION_ROUTE_PREFIX.length).split('/');
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
  const taskPath = workspaceScopedPath(pathname);
  if (!taskPath.startsWith(TASK_ROUTE_PREFIX)) {
    return {};
  }

  const [encodedTaskId, runSegment, encodedRunId] = taskPath.slice(TASK_ROUTE_PREFIX.length).split('/');
  const taskId = decodePathSegment(encodedTaskId);
  if (!taskId) {
    return {};
  }

  return {
    taskId,
    runId: runSegment === 'runs' ? decodePathSegment(encodedRunId) : undefined,
  };
}

function workspaceScopedPath(pathname: string): string {
  if (!pathname.startsWith(WORKSPACE_ROUTE_PREFIX)) {
    return pathname;
  }

  const [, surfacePath = ''] = pathname.slice(WORKSPACE_ROUTE_PREFIX.length).split(/\/(.+)/);
  return `/${surfacePath}`;
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
