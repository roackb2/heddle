import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import { createServerLogger, startHeddleControlPlaneServer } from '@/server/index.js';

describe('control-plane server lifecycle', () => {
  it('starts the standalone daemon lifecycle and clears its live server record on close', async () => {
    const paths = createTestPaths('heddle-server-lifecycle-daemon-');
    const server = await startHeddleControlPlaneServer({
      mode: 'daemon',
      serverId: 'server-current',
      host: '127.0.0.1',
      port: 0,
      workspaceRoot: paths.workspaceRoot,
      stateRoot: paths.stateRoot,
      daemonRegistryPath: paths.registryPath,
      serveAssets: false,
      logger: createTestLogger(paths.stateRoot),
    });

    try {
      expect(server.port).toBeGreaterThan(0);
      expect(RuntimeDaemonRegistryService.read(paths.registryPath).server).toMatchObject({
        serverId: 'server-current',
        mode: 'daemon',
        host: '127.0.0.1',
        port: server.port,
      });
    } finally {
      await server.close();
    }

    expect(RuntimeDaemonRegistryService.read(paths.registryPath).server).toBeUndefined();
  });

  it('starts an embedded chat server through the same lifecycle path', async () => {
    const paths = createTestPaths('heddle-server-lifecycle-embedded-');
    const server = await startHeddleControlPlaneServer({
      mode: 'embedded-chat',
      serverId: 'embedded-current',
      host: '127.0.0.1',
      port: 0,
      workspaceRoot: paths.workspaceRoot,
      stateRoot: paths.stateRoot,
      daemonRegistryPath: paths.registryPath,
      serveAssets: false,
      logger: createTestLogger(paths.stateRoot),
    });

    try {
      expect(RuntimeDaemonRegistryService.read(paths.registryPath).server).toMatchObject({
        serverId: 'embedded-current',
        mode: 'embedded-chat',
        port: server.port,
      });
    } finally {
      await server.close();
    }
  });

  it('does not clear a newer live server record when an older lifecycle shuts down', async () => {
    const paths = createTestPaths('heddle-server-lifecycle-owner-');
    const server = await startHeddleControlPlaneServer({
      mode: 'daemon',
      serverId: 'server-old',
      host: '127.0.0.1',
      port: 0,
      workspaceRoot: paths.workspaceRoot,
      stateRoot: paths.stateRoot,
      daemonRegistryPath: paths.registryPath,
      serveAssets: false,
      logger: createTestLogger(paths.stateRoot),
    });

    RuntimeDaemonRegistryService.registerLiveServer({
      registryPath: paths.registryPath,
      server: {
        serverId: 'server-new',
        mode: 'embedded-chat',
        host: '127.0.0.1',
        port: server.port + 1,
        pid: process.pid,
        startedAt: '2026-06-02T00:00:00.000Z',
        lastSeenAt: '2026-06-02T00:00:01.000Z',
      },
    });

    await server.close();

    expect(RuntimeDaemonRegistryService.read(paths.registryPath).server).toMatchObject({
      serverId: 'server-new',
      mode: 'embedded-chat',
    });
  });
});

function createTestPaths(prefix: string) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), prefix));
  const stateRoot = join(workspaceRoot, '.heddle');
  const registryPath = FileDaemonRegistryRepository.resolvePath(mkdtempSync(join(tmpdir(), `${prefix}home-`)));
  return {
    workspaceRoot,
    stateRoot,
    registryPath,
  };
}

function createTestLogger(stateRoot: string) {
  return createServerLogger({
    stateRoot,
    console: false,
    logFilePath: join(stateRoot, 'logs', 'test-server.log'),
  });
}
