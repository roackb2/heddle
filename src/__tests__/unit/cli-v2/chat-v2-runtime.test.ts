import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneCommandRuntimeService } from '@/cli-v2/commands/control-plane-command-runtime.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import type { HeddleControlPlaneServerHandle } from '@/server/index.js';

describe('chat-v2 runtime bootstrap', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  it('attaches to a fresh live control-plane server', async () => {
    const startServer = vi.fn();
    const runtime = await ControlPlaneCommandRuntimeService.resolve({
      workspaceRoot: '/repo',
      stateDir: '.heddle',
      preferApiKey: false,
      forceOwnerConflict: false,
      runtimeHost: freshRuntimeHost,
    }, { startServer, createLogger: () => logger as never });

    expect(startServer).not.toHaveBeenCalled();
    expect(runtime).toMatchObject({
      kind: 'attached',
      trpcUrl: 'http://127.0.0.1:8765/trpc',
      serverId: 'server-1',
    });
    expect(ControlPlaneCommandRuntimeService.formatNotice(runtime, 'chat-v2')).toContain('attaching chat-v2');
  });

  it('starts an embedded control-plane server when no live server exists', async () => {
    const close = vi.fn(async () => undefined);
    const startServer = vi.fn(async (options) => createServerHandle({
      serverId: 'embedded-1',
      host: options.host,
      port: 8123,
      close,
    }));

    const runtime = await ControlPlaneCommandRuntimeService.resolve({
      workspaceRoot: '/repo',
      stateDir: '.heddle-test',
      preferApiKey: true,
      forceOwnerConflict: false,
      runtimeHost: {
        kind: 'none',
        registryPath: '/registry.json',
      },
    }, { startServer, createLogger: () => logger as never });

    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'embedded-chat',
      workspaceRoot: '/repo',
      stateRoot: '/repo/.heddle-test',
      preferApiKey: true,
      host: '127.0.0.1',
      port: 8765,
      logger,
    }));
    expect(runtime).toMatchObject({
      kind: 'embedded',
      trpcUrl: 'http://127.0.0.1:8123/trpc',
      serverId: 'embedded-1',
    });
    await runtime.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(ControlPlaneCommandRuntimeService.formatNotice(runtime, 'chat-v2')).toContain('browser=http://127.0.0.1:8123');
  });

  it('starts embedded when force-owner-conflict bypasses a live server', async () => {
    const startServer = vi.fn(async () => createServerHandle({
      serverId: 'forced-embedded',
      host: '127.0.0.1',
      port: 8765,
    }));

    const runtime = await ControlPlaneCommandRuntimeService.resolve({
      workspaceRoot: '/repo',
      stateDir: '.heddle',
      preferApiKey: false,
      forceOwnerConflict: true,
      runtimeHost: freshRuntimeHost,
    }, { startServer, createLogger: () => logger as never });

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(runtime.kind).toBe('embedded');
  });
});

const freshRuntimeHost: ResolvedRuntimeHost = {
  kind: 'server',
  registryPath: '/registry.json',
  serverId: 'server-1',
  mode: 'daemon',
  endpoint: {
    host: '127.0.0.1',
    port: 8765,
  },
  startedAt: '2026-06-02T00:00:00.000Z',
  lastSeenAt: '2026-06-02T00:00:01.000Z',
  stale: false,
  ageMs: 100,
};

function createServerHandle(input: {
  serverId: string;
  host: string;
  port: number;
  close?: () => Promise<void>;
}): HeddleControlPlaneServerHandle {
  return {
    mode: 'embedded-chat',
    serverId: input.serverId,
    host: input.host,
    port: input.port,
    endpoint: {
      host: input.host,
      port: input.port,
    },
    registryPath: '/registry.json',
    workspaceRoot: '/repo',
    stateRoot: '/repo/.heddle',
    startedAt: '2026-06-02T00:00:00.000Z',
    close: input.close ?? (async () => undefined),
  };
}
