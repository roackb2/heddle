import { describe, expect, it } from 'vitest';
import {
  isSettingsRoute,
  resolveAppSurface,
  resolveRouteSessionId,
  resolveRouteTaskSelection,
  resolveRouteWorkspaceId,
  routeForAppSurface,
  routeForSession,
  routeForSettingsSection,
  routeForTaskRun,
} from '../../../web-v2/layout/routes.js';

describe('web-v2 workspace routes', () => {
  it('builds workspace-scoped routes while preserving legacy fallbacks', () => {
    expect(routeForAppSurface('sessions')).toBe('/sessions');
    expect(routeForAppSurface('sessions', 'default')).toBe('/workspaces/default/sessions');
    expect(routeForSession('workspace/one', 'session 1')).toBe('/workspaces/workspace%2Fone/sessions/session%201');
    expect(routeForTaskRun('default', 'task-a', 'run-b')).toBe('/workspaces/default/tasks/task-a/runs/run-b');
    expect(routeForSettingsSection('memory', 'default')).toBe('/workspaces/default/settings/memory');
    expect(routeForSettingsSection('mcp', 'default')).toBe('/workspaces/default/settings/mcp');
    expect(routeForSettingsSection('agents', 'default')).toBe('/workspaces/default/settings/agents');
    expect(routeForSettingsSection('skills', 'default')).toBe('/workspaces/default/settings/skills');
  });

  it('parses workspace-scoped session, task, and settings routes', () => {
    expect(resolveRouteWorkspaceId('/workspaces/default/sessions/session-1')).toBe('default');
    expect(resolveAppSurface('/workspaces/default/sessions/session-1')).toBe('sessions');
    expect(resolveRouteSessionId('/workspaces/default/sessions/session-1')).toBe('session-1');
    expect(resolveRouteTaskSelection('/workspaces/default/tasks/task-a/runs/run-b')).toEqual({
      taskId: 'task-a',
      runId: 'run-b',
    });
    expect(isSettingsRoute('/workspaces/default/settings/general')).toBe(true);
  });
});
