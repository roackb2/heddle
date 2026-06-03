import { describe, expect, it, vi } from 'vitest';
import { ClientSharedProxyApiService } from '@/client-shared/api/proxy.js';
import { ControlPlaneCommandRuntimeService } from '@/cli-v2/commands/control-plane-command-runtime.js';
import { runHeartbeatCli } from '@/cli-v2/commands/heartbeat-command.js';
import { formatDurationMs, parseDurationMs, parseHeartbeatArgs } from '../../../cli/heartbeat.js';

describe('heartbeat CLI helpers', () => {
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
      await runHeartbeatCli(['task', 'list'], {
        workspaceRoot: '/repo',
        activeWorkspaceId: 'workspace-1',
        stateDir: '.heddle',
        preferApiKey: true,
        runtimeHost: {
          kind: 'none',
          registryPath: '/registry.json',
        },
      });
    } finally {
      resolve.mockRestore();
      createClient.mockRestore();
      stdout.mockRestore();
    }

    expect(query).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });
});
