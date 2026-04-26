import { describe, expect, it } from 'vitest';
import { isKnownControlPlanePath, pathForTab, sessionIdFromPath, tabFromPath } from '../web/features/control-plane/routes.js';

describe('control plane routes', () => {
  it('maps top-level paths to stable workspace tabs', () => {
    expect(tabFromPath('/overview')).toBe('overview');
    expect(tabFromPath('/sessions')).toBe('sessions');
    expect(tabFromPath('/sessions/session-1')).toBe('sessions');
    expect(tabFromPath('/tasks')).toBe('heartbeat');
    expect(tabFromPath('/workspaces')).toBe('workspaces');
  });

  it('maps tabs to durable browser paths', () => {
    expect(pathForTab('overview')).toBe('/overview');
    expect(pathForTab('sessions')).toBe('/sessions');
    expect(pathForTab('heartbeat')).toBe('/tasks');
    expect(pathForTab('workspaces')).toBe('/workspaces');
  });

  it('extracts session ids from session routes', () => {
    expect(sessionIdFromPath('/sessions/session-1')).toBe('session-1');
    expect(sessionIdFromPath('/sessions/session-1/review')).toBe('session-1');
    expect(sessionIdFromPath('/overview')).toBeUndefined();
  });

  it('recognizes routable control-plane paths', () => {
    expect(isKnownControlPlanePath('/')).toBe(true);
    expect(isKnownControlPlanePath('/overview')).toBe(true);
    expect(isKnownControlPlanePath('/sessions/session-1')).toBe(true);
    expect(isKnownControlPlanePath('/tasks')).toBe(true);
    expect(isKnownControlPlanePath('/workspaces')).toBe(true);
    expect(isKnownControlPlanePath('/sessions-old')).toBe(false);
    expect(isKnownControlPlanePath('/unknown')).toBe(false);
  });
});
