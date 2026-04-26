import { describe, expect, it } from 'vitest';
import { isKnownControlPlanePath, pathForSection, sectionFromPath, sessionIdFromPath } from '../../web/features/control-plane/routes.js';

describe('control plane routes', () => {
  it('maps top-level paths to stable workspace tabs', () => {
    expect(sectionFromPath('/overview')).toBe('overview');
    expect(sectionFromPath('/sessions')).toBe('sessions');
    expect(sectionFromPath('/sessions/session-1')).toBe('sessions');
    expect(sectionFromPath('/tasks')).toBe('tasks');
    expect(sectionFromPath('/workspaces')).toBe('workspaces');
  });

  it('maps tabs to durable browser paths', () => {
    expect(pathForSection('overview')).toBe('/overview');
    expect(pathForSection('sessions')).toBe('/sessions');
    expect(pathForSection('tasks')).toBe('/tasks');
    expect(pathForSection('workspaces')).toBe('/workspaces');
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
