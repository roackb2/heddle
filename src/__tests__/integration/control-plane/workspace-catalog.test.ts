import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_ID,
  FileWorkspaceRepository,
  RuntimeWorkspaceService,
} from '@/core/runtime/workspaces/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import { controlPlaneRouter } from '../../../server/features/control-plane/router.js';

describe('workspace catalog', () => {
  it('bootstraps a default workspace descriptor under the state root', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-catalog-'));
    const stateRoot = join(workspaceRoot, '.heddle');

    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const catalogPath = FileWorkspaceRepository.resolveCatalogPath(stateRoot);

    expect(existsSync(catalogPath)).toBe(true);
    expect(catalog).toMatchObject({
      version: 1,
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    });
    expect(catalog.workspaces).toHaveLength(1);
    expect(catalog.workspaces[0]).toMatchObject({
      id: DEFAULT_WORKSPACE_ID,
      anchorRoot: workspaceRoot,
      repoRoots: [workspaceRoot],
      stateRoot,
    });

    const saved = JSON.parse(readFileSync(catalogPath, 'utf8')) as typeof catalog;
    expect(saved.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(saved.workspaces[0]?.anchorRoot).toBe(workspaceRoot);
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
        ownerId: 'embedded-test',
        registryPath,
        endpoint: { host: '127.0.0.1', port: 0 },
        startedAt: '2026-04-26T00:00:00.000Z',
        workspaceOwner: null,
      },
      logger: pino({ level: 'silent' }),
    });

    const state = await caller.state();
    expect(state.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(state.workspace).toMatchObject({
      id: DEFAULT_WORKSPACE_ID,
      anchorRoot: workspaceRoot,
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
      anchorRoot: join(workspaceRoot, 'nested'),
      setActive: false,
      nextId: 'workspace-2',
    });

    expect(created.workspaces).toHaveLength(2);
    expect(created.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);

    const switched = RuntimeWorkspaceService.setActive({
      workspaceRoot,
      stateRoot,
      workspaceId: 'workspace-2',
    });

    expect(switched.activeWorkspaceId).toBe('workspace-2');
    expect(switched.activeWorkspace).toMatchObject({
      id: 'workspace-2',
      name: 'Second workspace',
      anchorRoot: join(workspaceRoot, 'nested'),
      stateRoot: join(workspaceRoot, 'nested', '.heddle'),
    });
  });

  it('can rename a workspace', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-rename-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });

    const renamed = RuntimeWorkspaceService.rename({
      workspaceRoot,
      stateRoot,
      workspaceId: DEFAULT_WORKSPACE_ID,
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
        ownerId: 'daemon-test',
        registryPath,
        endpoint: { host: '127.0.0.1', port: 8765 },
        startedAt: '2026-04-26T00:00:00.000Z',
        workspaceOwner: null,
      },
      logger: pino({ level: 'silent' }),
    });

    const created = await caller.workspaceCreate({
      name: 'Second workspace',
      anchorRoot: join(workspaceRoot, 'second'),
      setActive: true,
    });
    expect(created.activeWorkspaceId).not.toBe(DEFAULT_WORKSPACE_ID);
    expect(created.workspace).toMatchObject({
      name: 'Second workspace',
      anchorRoot: join(workspaceRoot, 'second'),
      stateRoot: join(workspaceRoot, 'second', '.heddle'),
    });

    const switched = await caller.workspaceSetActive({ workspaceId: DEFAULT_WORKSPACE_ID });
    expect(switched.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(switched.workspace.id).toBe(DEFAULT_WORKSPACE_ID);

    const renamed = await caller.workspaceRename({ workspaceId: DEFAULT_WORKSPACE_ID, name: 'Renamed default' });
    expect(renamed.workspace.name).toBe('Renamed default');

    const registeredStateRoots = RuntimeDaemonRegistryService.read(registryPath).workspaces.map((record) => record.workspace.stateRoot);
    expect(registeredStateRoots).toContain(stateRoot);
    expect(registeredStateRoots).toContain(join(workspaceRoot, 'second', '.heddle'));
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
        ownerId: 'daemon-test',
        registryPath,
        endpoint: { host: '127.0.0.1', port: 8765 },
        startedAt: '2026-04-26T00:00:00.000Z',
        workspaceOwner: null,
      },
      logger: pino({ level: 'silent' }),
    });

    const state = await caller.state();
    expect(state.knownWorkspaces.map((workspace) => workspace.anchorRoot)).toEqual([otherRoot]);
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
