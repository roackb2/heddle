import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';

describe('daemon registry', () => {
  it('registers daemon ownership for workspace catalog entries', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-daemon-registry-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = FileDaemonRegistryRepository.resolvePath(mkdtempSync(join(tmpdir(), 'heddle-daemon-registry-home-')));
    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });

    const registry = RuntimeDaemonRegistryService.upsertWorkspaceRegistration({
      registryPath,
      workspaces: catalog.workspaces,
      owner: {
        ownerId: 'daemon-1',
        mode: 'daemon',
        host: '127.0.0.1',
        port: 8765,
        pid: 1234,
        startedAt: '2026-04-21T00:00:00.000Z',
        workspaceRoot,
        stateRoot,
      },
    });

    expect(registry.workspaces).toHaveLength(1);
    expect(registry.workspaces[0]).toMatchObject({
      workspace: {
        id: 'default',
        anchorRoot: workspaceRoot,
      },
      owner: {
        ownerId: 'daemon-1',
        host: '127.0.0.1',
        port: 8765,
        workspaceRoot,
        stateRoot,
      },
    });

    expect(RuntimeDaemonRegistryService.readWorkspaceRegistration(registryPath, 'default')?.owner?.ownerId).toBe('daemon-1');
  });

  it('clears ownership only for the matching daemon owner', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-daemon-clear-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = FileDaemonRegistryRepository.resolvePath(mkdtempSync(join(tmpdir(), 'heddle-daemon-clear-home-')));
    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });

    RuntimeDaemonRegistryService.upsertWorkspaceRegistration({
      registryPath,
      workspaces: catalog.workspaces,
      owner: {
        ownerId: 'daemon-1',
        mode: 'daemon',
        host: '127.0.0.1',
        port: 8765,
        pid: 1234,
        startedAt: '2026-04-21T00:00:00.000Z',
        workspaceRoot,
        stateRoot,
      },
    });

    RuntimeDaemonRegistryService.clearWorkspaceRegistration({
      registryPath,
      workspaceIds: ['default'],
      ownerId: 'daemon-2',
    });
    expect(RuntimeDaemonRegistryService.readWorkspaceRegistration(registryPath, 'default')?.owner?.ownerId).toBe('daemon-1');

    RuntimeDaemonRegistryService.clearWorkspaceRegistration({
      registryPath,
      workspaceIds: ['default'],
      ownerId: 'daemon-1',
    });
    expect(RuntimeDaemonRegistryService.readWorkspaceRegistration(registryPath, 'default')?.owner).toBeUndefined();
  });

  it('keeps default-id workspaces distinct by state root', () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'heddle-daemon-registry-first-'));
    const secondRoot = mkdtempSync(join(tmpdir(), 'heddle-daemon-registry-second-'));
    const registryPath = FileDaemonRegistryRepository.resolvePath(mkdtempSync(join(tmpdir(), 'heddle-daemon-registry-global-home-')));
    const firstCatalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot: firstRoot, stateRoot: join(firstRoot, '.heddle') });
    const secondCatalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot: secondRoot, stateRoot: join(secondRoot, '.heddle') });

    RuntimeDaemonRegistryService.registerKnownWorkspaces({ registryPath, workspaces: firstCatalog.workspaces });
    const registry = RuntimeDaemonRegistryService.registerKnownWorkspaces({ registryPath, workspaces: secondCatalog.workspaces });

    expect(registry.workspaces).toHaveLength(2);
    expect(RuntimeDaemonRegistryService.readWorkspaceRegistration(registryPath, 'default', join(firstRoot, '.heddle'))?.workspace.anchorRoot).toBe(firstRoot);
    expect(RuntimeDaemonRegistryService.readWorkspaceRegistration(registryPath, 'default', join(secondRoot, '.heddle'))?.workspace.anchorRoot).toBe(secondRoot);
  });
});
