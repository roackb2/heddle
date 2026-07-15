import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  FileWorkspaceRepository,
  RuntimeWorkspaceService,
} from '@/core/runtime/workspaces/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
import { controlPlaneRouter } from '@/server/routes/trpc/control-plane.js';

describe('workspace catalog', () => {
  it('bootstraps a default workspace descriptor under the state root', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-catalog-'));
    const stateRoot = join(workspaceRoot, '.heddle');

    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const catalogPath = FileWorkspaceRepository.resolveCatalogPath(stateRoot);

    expect(existsSync(catalogPath)).toBe(true);
    expect(catalog).toMatchObject({
      version: 1,
      activeWorkspaceId: catalog.workspaces[0]?.id,
    });
    expect(catalog.activeWorkspaceId).toMatch(/^workspace-/);
    expect(catalog.workspaces).toHaveLength(1);
    expect(catalog.workspaces[0]).toMatchObject({
      id: catalog.activeWorkspaceId,
      workspaceRoot,
      repoRoots: [workspaceRoot],
      stateRoot,
    });

    const saved = JSON.parse(readFileSync(catalogPath, 'utf8')) as typeof catalog;
    expect(saved.activeWorkspaceId).toBe(catalog.activeWorkspaceId);
    expect(saved.workspaces[0]?.workspaceRoot).toBe(workspaceRoot);
  });

  it('exposes the active workspace in control-plane state', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-router-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = FileDaemonRegistryRepository.resolvePath(mkdtempSync(join(tmpdir(), 'heddle-workspace-router-home-')));
    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const activeWorkspace = catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('expected default workspace');
    }

    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: catalog.workspaces,
      runtimeHost: {
        mode: 'daemon',
        serverId: 'embedded-test',
        registryPath,
        endpoint: { host: '127.0.0.1', port: 0 },
        startedAt: '2026-04-26T00:00:00.000Z',
      },
      logger: pino({ level: 'silent' }),
    });

    const state = await caller.state();
    expect(state.activeWorkspaceId).toBe(activeWorkspace.id);
    expect(state.workspace).toMatchObject({
      id: activeWorkspace.id,
      workspaceRoot,
      stateRoot,
    });
    expect(state.workspaces).toHaveLength(1);
    expect(state.knownWorkspaces).toEqual([]);
    expect(state.sessions).toEqual([
      expect.objectContaining({
        id: 'session-1',
        name: 'Session 1',
        model: 'gpt-5.4',
      }),
    ]);
    expect(state.heartbeat.tasks).toEqual([]);
    expect(state.memory.catalog).toBeDefined();
    expect(state.runtimeHost?.registryPath).toBe(registryPath);
    expect(RuntimeDaemonRegistryService.read(registryPath).workspaces.map((record) => record.workspace.stateRoot)).toContain(stateRoot);
  });

  it('can create and switch the active workspace', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-switch-'));
    const stateRoot = join(workspaceRoot, '.heddle');

    RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const created = RuntimeWorkspaceService.createDescriptor({
      workspaceRoot,
      stateRoot,
      name: 'Second workspace',
      newWorkspaceRoot: join(workspaceRoot, 'nested'),
      setActive: false,
      nextId: 'workspace-2',
    });

    expect(created.workspaces).toHaveLength(2);
    expect(created.activeWorkspaceId).toBe(created.workspaces[0]?.id);

    const switched = RuntimeWorkspaceService.setActive({
      workspaceRoot,
      stateRoot,
      workspaceId: 'workspace-2',
    });

    expect(switched.activeWorkspaceId).toBe('workspace-2');
    expect(switched.activeWorkspace).toMatchObject({
      id: 'workspace-2',
      name: 'Second workspace',
      workspaceRoot: join(workspaceRoot, 'nested'),
      stateRoot: join(workspaceRoot, 'nested', '.heddle'),
    });
  });

  it('can rename a workspace', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-rename-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const activeWorkspace = catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('expected active workspace');
    }

    const renamed = RuntimeWorkspaceService.rename({
      workspaceRoot,
      stateRoot,
      workspaceId: activeWorkspace.id,
      name: 'Primary workspace',
    });

    expect(renamed.activeWorkspace.name).toBe('Primary workspace');
    expect(renamed.workspaces[0]?.name).toBe('Primary workspace');
  });

  it('exposes router mutations for workspace create and switch', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-router-mutations-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = FileDaemonRegistryRepository.resolvePath(mkdtempSync(join(tmpdir(), 'heddle-workspace-router-mutations-home-')));
    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const activeWorkspace = catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('expected default workspace');
    }

    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: catalog.workspaces,
      runtimeHost: {
        mode: 'daemon',
        serverId: 'daemon-test',
        registryPath,
        endpoint: { host: '127.0.0.1', port: 8765 },
        startedAt: '2026-04-26T00:00:00.000Z',
      },
      logger: pino({ level: 'silent' }),
    });

    const created = await caller.workspaceCreate({
      name: 'Second workspace',
      workspaceRoot: join(workspaceRoot, 'second'),
      setActive: true,
    });
    expect(created.activeWorkspaceId).not.toBe(activeWorkspace.id);
    expect(created.workspace).toMatchObject({
      name: 'Second workspace',
      workspaceRoot: join(workspaceRoot, 'second'),
      stateRoot: join(workspaceRoot, 'second', '.heddle'),
    });

    const switched = await caller.workspaceSetActive({ workspaceId: activeWorkspace.id });
    expect(switched.activeWorkspaceId).toBe(activeWorkspace.id);
    expect(switched.workspace.id).toBe(activeWorkspace.id);

    const renamed = await caller.workspaceRename({ workspaceId: activeWorkspace.id, name: 'Renamed default' });
    expect(renamed.workspace.name).toBe('Renamed default');

    const registeredStateRoots = RuntimeDaemonRegistryService.read(registryPath).workspaces.map((record) => record.workspace.stateRoot);
    expect(registeredStateRoots).toContain(stateRoot);
    expect(registeredStateRoots).toContain(join(workspaceRoot, 'second', '.heddle'));
  });

  it('routes session APIs through the requested workspace state root without switching active workspace', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-session-routing-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = FileDaemonRegistryRepository.resolvePath(mkdtempSync(join(tmpdir(), 'heddle-workspace-session-routing-home-')));
    RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const resolved = RuntimeWorkspaceService.createDescriptor({
      workspaceRoot,
      stateRoot,
      name: 'Second workspace',
      newWorkspaceRoot: join(workspaceRoot, 'second'),
      setActive: false,
      nextId: 'workspace-2',
    });
    const activeWorkspace = resolved.workspaces.find((workspace) => workspace.id === resolved.activeWorkspaceId);
    const secondWorkspace = resolved.workspaces.find((workspace) => workspace.id === 'workspace-2');
    if (!activeWorkspace || !secondWorkspace) {
      throw new Error('expected both workspaces');
    }

    await createConversationEngine({
      workspaceRoot: activeWorkspace.workspaceRoot,
      stateRoot: activeWorkspace.stateRoot,
      model: 'gpt-5.4',
      workspaceId: activeWorkspace.id,
      apiKeyPresent: true,
    }).sessions.create({ id: 'session-1', name: 'Default workspace session' });
    await createConversationEngine({
      workspaceRoot: secondWorkspace.workspaceRoot,
      stateRoot: secondWorkspace.stateRoot,
      model: 'gpt-5.4',
      workspaceId: secondWorkspace.id,
      apiKeyPresent: true,
    }).sessions.create({ id: 'session-1', name: 'Second workspace session' });

    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: resolved.workspaces,
      runtimeHost: {
        mode: 'daemon',
        serverId: 'daemon-test',
        registryPath,
        endpoint: { host: '127.0.0.1', port: 8765 },
        startedAt: '2026-04-26T00:00:00.000Z',
      },
      logger: pino({ level: 'silent' }),
    });

    const defaultSessions = await caller.sessions({ workspaceId: activeWorkspace.id });
    const secondSessions = await caller.sessions({ workspaceId: secondWorkspace.id });
    expect(defaultSessions.sessions.map((session) => session.name)).toEqual(['Default workspace session']);
    expect(secondSessions.sessions.map((session) => session.name)).toEqual(['Second workspace session']);
    await expect(caller.state({ workspaceId: secondWorkspace.id })).resolves.toMatchObject({
      activeWorkspaceId: secondWorkspace.id,
      workspace: {
        id: secondWorkspace.id,
        workspaceRoot: secondWorkspace.workspaceRoot,
        stateRoot: secondWorkspace.stateRoot,
      },
      sessions: [
        expect.objectContaining({
          id: 'session-1',
          name: 'Second workspace session',
          workspaceId: secondWorkspace.id,
        }),
      ],
    });

    await caller.sessionSettingsUpdate({
      workspaceId: secondWorkspace.id,
      id: 'session-1',
      model: 'gpt-5.5',
    });

    await expect(caller.session({ workspaceId: activeWorkspace.id, id: 'session-1' })).resolves.toMatchObject({
      id: 'session-1',
      name: 'Default workspace session',
      model: 'gpt-5.4',
      workspaceId: activeWorkspace.id,
    });
    await expect(caller.session({ workspaceId: secondWorkspace.id, id: 'session-1' })).resolves.toMatchObject({
      id: 'session-1',
      name: 'Second workspace session',
      model: 'gpt-5.5',
      workspaceId: secondWorkspace.id,
    });
  });

  it('routes workspace file search through the requested workspace root', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-file-routing-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const resolved = RuntimeWorkspaceService.createDescriptor({
      workspaceRoot,
      stateRoot,
      name: 'Second workspace',
      newWorkspaceRoot: join(workspaceRoot, 'second'),
      setActive: false,
      nextId: 'workspace-2',
    });
    const activeWorkspace = resolved.workspaces.find((workspace) => workspace.id === resolved.activeWorkspaceId);
    const secondWorkspace = resolved.workspaces.find((workspace) => workspace.id === 'workspace-2');
    if (!activeWorkspace || !secondWorkspace) {
      throw new Error('expected both workspaces');
    }

    mkdirSync(activeWorkspace.workspaceRoot, { recursive: true });
    mkdirSync(secondWorkspace.workspaceRoot, { recursive: true });
    writeFileSync(join(activeWorkspace.workspaceRoot, 'active-only.md'), 'active\n');
    writeFileSync(join(secondWorkspace.workspaceRoot, 'second-only.md'), 'second\n');

    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: resolved.workspaces,
      runtimeHost: null,
      logger: pino({ level: 'silent' }),
    });

    await expect(caller.workspaceFileSearch({
      workspaceId: secondWorkspace.id,
      query: 'only',
    })).resolves.toMatchObject({
      files: [{ path: 'second-only.md' }],
    });

    const secondWorkspaceLog = await readLogUntil(join(secondWorkspace.stateRoot, 'logs', 'server.log'), 'workspaceFileSearch');
    expect(secondWorkspaceLog).toContain(secondWorkspace.stateRoot);
    expect(existsSync(join(activeWorkspace.stateRoot, 'logs', 'server.log'))).toBe(false);
  });

  it('repairs legacy workspace roots before routing file search', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-repair-default-'));
    const secondRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-repair-second-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const secondStateRoot = join(secondRoot, '.heddle');
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(secondRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, 'default-only.md'), 'default\n');
    writeFileSync(join(secondRoot, 'second-only.md'), 'second\n');
    const timestamp = '2026-05-25T00:00:00.000Z';
    writeFileSync(FileWorkspaceRepository.resolveCatalogPath(stateRoot), JSON.stringify({
      version: 1,
      activeWorkspaceId: 'workspace-2',
      workspaces: [
        {
          id: 'default',
          name: 'Default workspace',
          workspaceRoot,
          repoRoots: [workspaceRoot],
          stateRoot,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: 'workspace-2',
          name: 'Second workspace',
          workspaceRoot,
          repoRoots: [workspaceRoot],
          stateRoot: secondStateRoot,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }, null, 2));

    const resolved = RuntimeWorkspaceService.resolveContext({ workspaceRoot, stateRoot });
    const secondWorkspace = resolved.workspaces.find((workspace) => workspace.id === 'workspace-2');
    if (!secondWorkspace) {
      throw new Error('expected repaired second workspace');
    }
    expect(secondWorkspace).toMatchObject({
      workspaceRoot: secondRoot,
      repoRoots: [secondRoot],
      stateRoot: secondStateRoot,
    });

    const saved = JSON.parse(readFileSync(FileWorkspaceRepository.resolveCatalogPath(stateRoot), 'utf8')) as typeof resolved.catalog;
    expect(saved.workspaces.find((workspace) => workspace.id === 'workspace-2')).toMatchObject({
      workspaceRoot: secondRoot,
      repoRoots: [secondRoot],
      stateRoot: secondStateRoot,
    });

    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: resolved.activeWorkspaceId,
      activeWorkspace: resolved.activeWorkspace,
      workspaces: resolved.workspaces,
      runtimeHost: null,
      logger: pino({ level: 'silent' }),
    });

    await expect(caller.workspaceFileSearch({
      workspaceId: secondWorkspace.id,
      query: 'only',
    })).resolves.toMatchObject({
      files: [{ path: 'second-only.md' }],
    });
  });

  it('exposes known workspaces from the user-level registry', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-known-current-'));
    const otherRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-known-other-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const registryPath = FileDaemonRegistryRepository.resolvePath(mkdtempSync(join(tmpdir(), 'heddle-workspace-known-home-')));
    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const otherCatalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot: otherRoot, stateRoot: join(otherRoot, '.heddle') });
    const activeWorkspace = catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('expected default workspace');
    }
    RuntimeDaemonRegistryService.registerKnownWorkspaces({ registryPath, workspaces: catalog.workspaces });
    RuntimeDaemonRegistryService.registerKnownWorkspaces({ registryPath, workspaces: otherCatalog.workspaces });

    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: catalog.workspaces,
      runtimeHost: {
        mode: 'daemon',
        serverId: 'daemon-test',
        registryPath,
        endpoint: { host: '127.0.0.1', port: 8765 },
        startedAt: '2026-04-26T00:00:00.000Z',
      },
      logger: pino({ level: 'silent' }),
    });

    const state = await caller.state();
    expect(state.knownWorkspaces.map((workspace) => workspace.workspaceRoot)).toEqual([otherRoot]);
  });

  it('can browse local directories for workspace selection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-workspace-browse-'));
    const appRoot = join(root, 'app');
    const hiddenRoot = join(root, '.hidden');
    const plainRoot = join(root, 'plain');
    mkdirSync(join(appRoot, '.git'), { recursive: true });
    mkdirSync(hiddenRoot, { recursive: true });
    mkdirSync(plainRoot, { recursive: true });
    writeFileSync(join(appRoot, 'package.json'), '{}\n');
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-browse-current-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const activeWorkspace = catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('expected default workspace');
    }
    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: catalog.workspaces,
      runtimeHost: null,
      logger: pino({ level: 'silent' }),
    });

    const listing = await caller.workspaceBrowse({ path: root });
    expect(listing.entries[0]).toMatchObject({
      name: 'app',
      path: appRoot,
      hasGit: true,
      hasPackageJson: true,
    });
    expect(listing.entries.map((entry) => entry.name)).toContain('plain');
    expect(listing.entries.map((entry) => entry.name)).not.toContain('.hidden');

    const listingWithHidden = await caller.workspaceBrowse({ path: root, includeHidden: true });
    expect(listingWithHidden.entries.map((entry) => entry.name)).toContain('.hidden');
  });
});

async function readLogUntil(path: string, expectedText: string): Promise<string> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      if (text.includes(expectedText)) {
        return text;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
