import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearDaemonWorkspaceRegistration,
  readDaemonWorkspaceRegistration,
  resolveDaemonRegistryPath,
  upsertDaemonWorkspaceRegistration,
} from '../core/runtime/daemon-registry.js';
import { ensureWorkspaceCatalog } from '../core/runtime/workspaces.js';

describe('daemon registry', () => {
  it('registers daemon ownership for workspace catalog entries', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-daemon-registry-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = resolveDaemonRegistryPath(mkdtempSync(join(tmpdir(), 'heddle-daemon-registry-home-')));
    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });

    const registry = upsertDaemonWorkspaceRegistration({
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

    expect(readDaemonWorkspaceRegistration(registryPath, 'default')?.owner?.ownerId).toBe('daemon-1');
  });

  it('clears ownership only for the matching daemon owner', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-daemon-clear-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = resolveDaemonRegistryPath(mkdtempSync(join(tmpdir(), 'heddle-daemon-clear-home-')));
    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });

    upsertDaemonWorkspaceRegistration({
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

    clearDaemonWorkspaceRegistration({
      registryPath,
      workspaceIds: ['default'],
      ownerId: 'daemon-2',
    });
    expect(readDaemonWorkspaceRegistration(registryPath, 'default')?.owner?.ownerId).toBe('daemon-1');

    clearDaemonWorkspaceRegistration({
      registryPath,
      workspaceIds: ['default'],
      ownerId: 'daemon-1',
    });
    expect(readDaemonWorkspaceRegistration(registryPath, 'default')?.owner).toBeUndefined();
  });
});
