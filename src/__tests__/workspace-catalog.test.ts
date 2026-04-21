import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  createWorkspaceDescriptor,
  DEFAULT_WORKSPACE_ID,
  ensureWorkspaceCatalog,
  resolveWorkspaceCatalogPath,
  setActiveWorkspace,
} from '../core/runtime/workspaces.js';
import { controlPlaneRouter } from '../server/features/control-plane/router.js';

describe('workspace catalog', () => {
  it('bootstraps a default workspace descriptor under the state root', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-catalog-'));
    const stateRoot = join(workspaceRoot, '.heddle');

    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });
    const catalogPath = resolveWorkspaceCatalogPath(stateRoot);

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
    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });
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

    const state = await caller.state();
    expect(state.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(state.workspace).toMatchObject({
      id: DEFAULT_WORKSPACE_ID,
      anchorRoot: workspaceRoot,
      stateRoot,
    });
    expect(state.workspaces).toHaveLength(1);
    expect(state.runtimeHost).toBeNull();
  });

  it('can create and switch the active workspace', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-switch-'));
    const stateRoot = join(workspaceRoot, '.heddle');

    ensureWorkspaceCatalog({ workspaceRoot, stateRoot });
    const created = createWorkspaceDescriptor({
      workspaceRoot,
      stateRoot,
      name: 'Second workspace',
      anchorRoot: join(workspaceRoot, 'nested'),
      setActive: false,
      nextId: 'workspace-2',
    });

    expect(created.workspaces).toHaveLength(2);
    expect(created.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);

    const switched = setActiveWorkspace({
      workspaceRoot,
      stateRoot,
      workspaceId: 'workspace-2',
    });

    expect(switched.activeWorkspaceId).toBe('workspace-2');
    expect(switched.activeWorkspace).toMatchObject({
      id: 'workspace-2',
      name: 'Second workspace',
      anchorRoot: join(workspaceRoot, 'nested'),
    });
  });

  it('exposes router mutations for workspace create and switch', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-workspace-router-mutations-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });
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

    const created = await caller.workspaceCreate({
      name: 'Second workspace',
      anchorRoot: join(workspaceRoot, 'second'),
      setActive: true,
    });
    expect(created.activeWorkspaceId).not.toBe(DEFAULT_WORKSPACE_ID);
    expect(created.workspace).toMatchObject({
      name: 'Second workspace',
      anchorRoot: join(workspaceRoot, 'second'),
    });

    const switched = await caller.workspaceSetActive({ workspaceId: DEFAULT_WORKSPACE_ID });
    expect(switched.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(switched.workspace.id).toBe(DEFAULT_WORKSPACE_ID);
  });
});
