import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  daemonStartConflictMessage,
  embeddedCommandConflictMessage,
  formatRuntimeHostNotice,
  resolveWorkspaceRuntimeHost,
} from '../../../core/runtime/runtime-hosts.js';
import { upsertDaemonWorkspaceRegistration, resolveDaemonRegistryPath } from '../../../core/runtime/daemon-registry.js';
import { ensureWorkspaceCatalog } from '../../../core/runtime/workspaces.js';

describe('runtime host discovery', () => {
  it('returns none when no daemon owner exists for the workspace', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-runtime-host-none-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = resolveDaemonRegistryPath(mkdtempSync(join(tmpdir(), 'heddle-runtime-host-none-home-')));

    ensureWorkspaceCatalog({ workspaceRoot, stateRoot });
    const resolved = resolveWorkspaceRuntimeHost({ workspaceRoot, stateRoot, registryPath });

    expect(resolved).toMatchObject({
      kind: 'none',
      workspaceId: 'default',
    });
  });

  it('returns active daemon ownership when the registry owner is fresh', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-runtime-host-daemon-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = resolveDaemonRegistryPath(mkdtempSync(join(tmpdir(), 'heddle-runtime-host-home-')));
    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });

    upsertDaemonWorkspaceRegistration({
      registryPath,
      workspaces: catalog.workspaces,
      owner: {
        ownerId: 'daemon-1',
        mode: 'daemon',
        host: '127.0.0.1',
        port: 8765,
        pid: 42,
        startedAt: '2026-04-21T00:00:00.000Z',
        lastSeenAt: '2026-04-21T00:00:30.000Z',
        workspaceRoot,
        stateRoot,
      },
    });

    const resolved = resolveWorkspaceRuntimeHost({
      workspaceRoot,
      stateRoot,
      registryPath,
      now: Date.parse('2026-04-21T00:00:45.000Z'),
      isPidAlive: () => true,
    });

    expect(resolved).toMatchObject({
      kind: 'daemon',
      ownerId: 'daemon-1',
      endpoint: {
        host: '127.0.0.1',
        port: 8765,
      },
      stale: false,
    });
    expect(formatRuntimeHostNotice('chat', resolved)).toContain('Embedded chat still works here');
    expect(embeddedCommandConflictMessage('chat', resolved)).toContain('Refusing embedded `chat`');
    expect(daemonStartConflictMessage(resolved)).toContain('Refusing to start a second daemon');
  });

  it('marks daemon ownership stale when lastSeenAt is too old', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-runtime-host-stale-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = resolveDaemonRegistryPath(mkdtempSync(join(tmpdir(), 'heddle-runtime-host-stale-home-')));
    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });

    upsertDaemonWorkspaceRegistration({
      registryPath,
      workspaces: catalog.workspaces,
      owner: {
        ownerId: 'daemon-1',
        mode: 'daemon',
        host: '127.0.0.1',
        port: 8765,
        pid: 42,
        startedAt: '2026-04-21T00:00:00.000Z',
        lastSeenAt: '2026-04-21T00:00:00.000Z',
        workspaceRoot,
        stateRoot,
      },
    });

    const resolved = resolveWorkspaceRuntimeHost({
      workspaceRoot,
      stateRoot,
      registryPath,
      now: Date.parse('2026-04-21T00:01:00.000Z'),
      staleAfterMs: 10_000,
      isPidAlive: () => true,
    });

    expect(resolved).toMatchObject({
      kind: 'daemon',
      stale: true,
    });
    expect(formatRuntimeHostNotice('ask', resolved)).toBeUndefined();
    expect(embeddedCommandConflictMessage('ask', resolved)).toBeUndefined();
    expect(daemonStartConflictMessage(resolved)).toBeUndefined();
  });

  it('marks daemon ownership stale when the recorded daemon pid is gone', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-runtime-host-dead-pid-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = resolveDaemonRegistryPath(mkdtempSync(join(tmpdir(), 'heddle-runtime-host-dead-pid-home-')));
    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });

    upsertDaemonWorkspaceRegistration({
      registryPath,
      workspaces: catalog.workspaces,
      owner: {
        ownerId: 'daemon-1',
        mode: 'daemon',
        host: '127.0.0.1',
        port: 8765,
        pid: 4242,
        startedAt: '2026-04-21T00:00:00.000Z',
        lastSeenAt: '2026-04-21T00:00:30.000Z',
        workspaceRoot,
        stateRoot,
      },
    });

    const resolved = resolveWorkspaceRuntimeHost({
      workspaceRoot,
      stateRoot,
      registryPath,
      now: Date.parse('2026-04-21T00:00:31.000Z'),
      isPidAlive: () => false,
    });

    expect(resolved).toMatchObject({
      kind: 'daemon',
      stale: true,
    });
    expect(daemonStartConflictMessage(resolved)).toBeUndefined();
  });
});
