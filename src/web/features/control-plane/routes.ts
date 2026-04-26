import { matchPath } from 'react-router';
import type { ControlPlaneTab } from './mobile/MobileControlPlaneShell';

export type ControlPlaneRouteTab = ControlPlaneTab;

export function tabFromPath(pathname: string): ControlPlaneRouteTab {
  if (isPathInSection(pathname, '/overview')) {
    return 'overview';
  }
  if (isPathInSection(pathname, '/tasks')) {
    return 'heartbeat';
  }
  if (isPathInSection(pathname, '/workspaces')) {
    return 'workspaces';
  }
  return 'sessions';
}

export function pathForTab(tab: ControlPlaneRouteTab): string {
  if (tab === 'overview') {
    return '/overview';
  }
  if (tab === 'heartbeat') {
    return '/tasks';
  }
  if (tab === 'workspaces') {
    return '/workspaces';
  }
  return '/sessions';
}

export function sessionIdFromPath(pathname: string): string | undefined {
  return matchPath('/sessions/:sessionId/*', pathname)?.params.sessionId;
}

export function isKnownControlPlanePath(pathname: string): boolean {
  return pathname === '/'
    || isPathInSection(pathname, '/overview')
    || isPathInSection(pathname, '/sessions')
    || isPathInSection(pathname, '/tasks')
    || isPathInSection(pathname, '/workspaces');
}

function isPathInSection(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}
