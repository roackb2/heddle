import { describe, expect, it, vi } from 'vitest';
import { ClientSharedProxyApiService } from '@/client-shared/api/proxy.js';
import { ControlPlaneCommandRuntimeService } from '@/cli-v2/commands/control-plane-command-runtime.js';
import { HeartbeatCliCommandEdgeService } from '@/cli-v2/commands/heartbeat-command.js';
import { formatDurationMs, parseDurationMs, parseHeartbeatArgs } from '../../../cli/heartbeat.js';

describe('heartbeat CLI helpers', () => {
  it('treats a bare heartbeat command as discovery help', () => {
    expect(parseHeartbeatArgs([])).toEqual({
      command: 'help',
      subcommand: undefined,
      rest: [],
      flags: {},
    });
  });

  it('parses heartbeat subcommands and flags', () => {
    expect(parseHeartbeatArgs([
      'task',
      'add',
      '--id',
      'repo-gardener',
      '--task=Maintain the repo',
      '--every',
      '15m',
      '--disabled',
    ])).toEqual({
      command: 'task',
      subcommand: 'add',
      rest: [],
      flags: {
        id: 'repo-gardener',
        task: 'Maintain the repo',
        every: '15m',
        disabled: true,
      },
    });
  });

  it('parses the convenience heartbeat start command', () => {
    expect(parseHeartbeatArgs([
      'start',
      '--every',
      '10m',
      '--task',
      'Watch the repo',
      '--once',
    ])).toEqual({
      command: 'start',
      subcommand: undefined,
      rest: [],
      flags: {
        every: '10m',
        task: 'Watch the repo',
        once: true,
      },
    });
  });

  it('parses heartbeat run history commands', () => {
    expect(parseHeartbeatArgs([
      'runs',
      'show',
      'latest',
      '--task',
      'repo-gardener',
    ])).toEqual({
      command: 'runs',
      subcommand: 'show',
      rest: ['latest'],
      flags: {
        task: 'repo-gardener',
      },
    });
  });

  it('parses and formats scheduler durations', () => {
    expect(parseDurationMs('500ms')).toBe(500);
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('15m')).toBe(15 * 60_000);
    expect(parseDurationMs('2h')).toBe(2 * 60 * 60_000);
    expect(parseDurationMs('1d')).toBe(24 * 60 * 60_000);

    expect(formatDurationMs(500)).toBe('500ms');
    expect(formatDurationMs(30_000)).toBe('30s');
    expect(formatDurationMs(15 * 60_000)).toBe('15m');
    expect(formatDurationMs(2 * 60 * 60_000)).toBe('2h');
    expect(formatDurationMs(24 * 60 * 60_000)).toBe('1d');
  });

  it('rejects invalid scheduler durations', () => {
    expect(() => parseDurationMs('soon')).toThrow('Invalid duration');
    expect(() => parseDurationMs('0s')).toThrow('Invalid duration');
  });

  it('routes heartbeat task listing through the control-plane API', async () => {
    const query = vi.fn(async () => ({ workspaceId: 'workspace-1', tasks: [] }));
    const runtime = {
      kind: 'attached' as const,
      trpcUrl: 'http://127.0.0.1:8765/trpc',
      endpoint: {
        host: '127.0.0.1',
        port: 8765,
      },
      serverId: 'server-1',
      close: vi.fn(async () => undefined),
    };
    const resolve = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve').mockResolvedValue(runtime);
    const createClient = vi.spyOn(ClientSharedProxyApiService, 'createClient').mockReturnValue({
      controlPlane: {
        heartbeatTasks: {
          query,
        },
      },
    } as never);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await HeartbeatCliCommandEdgeService.run(['task', 'list'], {
        workspaceRoot: '/repo',
        activeWorkspaceId: 'workspace-1',
        stateDir: '.heddle',
        preferApiKey: true,
        runtimeHost: {
          kind: 'none',
          registryPath: '/registry.json',
        },
      });
      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
        heartbeatScheduler: {
          enabled: false,
        },
      }));
      expect(query).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
      expect(runtime.close).toHaveBeenCalledTimes(1);
    } finally {
      resolve.mockRestore();
      createClient.mockRestore();
      stdout.mockRestore();
    }
  });

  it('passes embedded scheduler config for heartbeat start', async () => {
    const runtime = {
      kind: 'attached' as const,
      trpcUrl: 'http://127.0.0.1:8765/trpc',
      endpoint: {
        host: '127.0.0.1',
        port: 8765,
      },
      serverId: 'server-1',
      close: vi.fn(async () => undefined),
    };
    const resolve = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve').mockResolvedValue(runtime);
    const createClient = vi.spyOn(ClientSharedProxyApiService, 'createClient').mockReturnValue({
      controlPlane: {
        heartbeatTasks: {
          query: vi.fn(async () => ({ tasks: [] })),
        },
        heartbeatTaskCreate: {
          mutate: vi.fn(async () => ({ task: { taskId: 'repo-gardener', state: { status: 'idle' } } })),
        },
      },
    } as never);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await HeartbeatCliCommandEdgeService.run(['start', '--id', 'repo-gardener', '--task', 'Maintain the repo', '--poll', '5s'], {
        workspaceRoot: '/repo',
        activeWorkspaceId: 'workspace-1',
        stateDir: '.heddle',
        preferApiKey: true,
        runtimeHost: {
          kind: 'none',
          registryPath: '/registry.json',
        },
      }).catch(() => undefined);
      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
        heartbeatScheduler: {
          enabled: true,
          pollIntervalMs: 5_000,
        },
      }));
    } finally {
      resolve.mockRestore();
      createClient.mockRestore();
      stdout.mockRestore();
    }
  });

  it('rejects --poll when heartbeat start attaches to a live server', async () => {
    const runtime = {
      kind: 'attached' as const,
      trpcUrl: 'http://127.0.0.1:8765/trpc',
      endpoint: {
        host: '127.0.0.1',
        port: 8765,
      },
      serverId: 'server-1',
      close: vi.fn(async () => undefined),
    };
    const resolve = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve').mockResolvedValue(runtime);
    const createClient = vi.spyOn(ClientSharedProxyApiService, 'createClient');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await expect(HeartbeatCliCommandEdgeService.run(['start', '--poll', '5s'], {
        workspaceRoot: '/repo',
        activeWorkspaceId: 'workspace-1',
        stateDir: '.heddle',
        preferApiKey: true,
        runtimeHost: freshRuntimeHost(),
      })).rejects.toThrow('--poll only applies when heartbeat start launches an embedded control-plane server.');
      expect(createClient).not.toHaveBeenCalled();
      expect(runtime.close).toHaveBeenCalledTimes(1);
    } finally {
      resolve.mockRestore();
      createClient.mockRestore();
      stdout.mockRestore();
    }
  });
});

function freshRuntimeHost() {
  return {
    kind: 'server' as const,
    registryPath: '/registry.json',
    serverId: 'server-1',
    mode: 'daemon' as const,
    endpoint: {
      host: '127.0.0.1',
      port: 8765,
    },
    startedAt: '2026-06-02T00:00:00.000Z',
    lastSeenAt: '2026-06-02T00:00:01.000Z',
    stale: false,
    ageMs: 100,
  };
}
