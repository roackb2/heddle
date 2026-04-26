import { matchPath } from 'react-router';

export type ControlPlaneSection = 'overview' | 'sessions' | 'tasks' | 'workspaces';

export function sectionFromPath(pathname: string): ControlPlaneSection {
  if (isPathInSection(pathname, '/overview')) {
    return 'overview';
  }
  if (isPathInSection(pathname, '/tasks')) {
    return 'tasks';
  }
  if (isPathInSection(pathname, '/workspaces')) {
    return 'workspaces';
  }
  return 'sessions';
}

export function pathForSection(section: ControlPlaneSection): string {
  if (section === 'overview') {
    return '/overview';
  }
  if (section === 'tasks') {
    return '/tasks';
  }
  if (section === 'workspaces') {
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
