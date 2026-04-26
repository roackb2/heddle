import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectRuntimeHostSurface } from '../../web/features/control-plane/host-surface.js';
import type { ControlPlaneState } from '../../server/features/control-plane/types.js';

describe('projectRuntimeHostSurface', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns local control-plane state when no runtime host is loaded', () => {
    expect(projectRuntimeHostSurface(baseState())).toMatchObject({
      state: 'local',
      label: 'Local control plane',
      tone: 'outline',
    });
  });

  it('returns attached state when daemon owner heartbeat is fresh', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:30.000Z'));

    expect(projectRuntimeHostSurface(baseState({
      runtimeHost: {
        mode: 'daemon',
        ownerId: 'daemon-1',
        registryPath: '/tmp/registry.json',
        endpoint: { host: '127.0.0.1', port: 8765 },
        startedAt: '2026-04-21T12:00:00.000Z',
        workspaceOwner: {
          ownerId: 'daemon-1',
          mode: 'daemon',
          host: '127.0.0.1',
          port: 8765,
          pid: 123,
          startedAt: '2026-04-21T12:00:00.000Z',
          lastSeenAt: '2026-04-21T12:00:10.000Z',
          workspaceRoot: '/workspace',
          stateRoot: '/workspace/.heddle',
        },
      },
    }))).toMatchObject({
      state: 'attached',
      label: 'Attached to daemon',
      tone: 'secondary',
      endpoint: '127.0.0.1:8765',
    });
  });

  it('returns stale state when daemon owner heartbeat is too old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:02:00.000Z'));

    expect(projectRuntimeHostSurface(baseState({
      runtimeHost: {
        mode: 'daemon',
        ownerId: 'daemon-1',
        registryPath: '/tmp/registry.json',
        endpoint: { host: '127.0.0.1', port: 8765 },
        startedAt: '2026-04-21T12:00:00.000Z',
        workspaceOwner: {
          ownerId: 'daemon-1',
          mode: 'daemon',
          host: '127.0.0.1',
          port: 8765,
          pid: 123,
          startedAt: '2026-04-21T12:00:00.000Z',
          lastSeenAt: '2026-04-21T12:00:10.000Z',
          workspaceRoot: '/workspace',
          stateRoot: '/workspace/.heddle',
        },
      },
    }))).toMatchObject({
      state: 'stale',
      label: 'Daemon unreachable',
      tone: 'destructive',
    });
  });
});

function baseState(overrides: Partial<ControlPlaneState> = {}): ControlPlaneState {
  return {
    workspaceRoot: '/workspace',
    stateRoot: '/workspace/.heddle',
    activeWorkspaceId: 'default',
    workspace: {
      id: 'default',
      name: 'workspace',
      anchorRoot: '/workspace',
      stateRoot: '/workspace/.heddle',
      repoRoots: ['/workspace'],
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z',
    },
    workspaces: [],
    knownWorkspaces: [],
    runtimeHost: null,
    sessions: [],
    heartbeat: {
      tasks: [],
      runs: [],
    },
    ...overrides,
  };
}
