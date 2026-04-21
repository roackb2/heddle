import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const DEFAULT_WORKSPACE_ID = 'default';

export type WorkspaceDescriptor = {
  id: string;
  name: string;
  anchorRoot: string;
  repoRoots: string[];
  stateRoot: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCatalog = {
  version: 1;
  activeWorkspaceId: string;
  workspaces: WorkspaceDescriptor[];
};

export type ResolvedWorkspaceContext = {
  catalogPath: string;
  catalog: WorkspaceCatalog;
  activeWorkspaceId: string;
  activeWorkspace: WorkspaceDescriptor;
  workspaces: WorkspaceDescriptor[];
};

export function ensureWorkspaceCatalog(options: {
  workspaceRoot: string;
  stateRoot: string;
}): WorkspaceCatalog {
  const workspaceRoot = resolve(options.workspaceRoot);
  const stateRoot = resolve(options.stateRoot);
  const catalogPath = resolveWorkspaceCatalogPath(stateRoot);

  if (!existsSync(catalogPath)) {
    const catalog = createDefaultWorkspaceCatalog(workspaceRoot, stateRoot);
    saveWorkspaceCatalog(catalogPath, catalog);
    return catalog;
  }

  const parsed = readWorkspaceCatalog(catalogPath);
  const normalized = normalizeWorkspaceCatalog(parsed, workspaceRoot, stateRoot);
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    saveWorkspaceCatalog(catalogPath, normalized);
  }
  return normalized;
}

export function resolveWorkspaceContext(options: {
  workspaceRoot: string;
  stateRoot: string;
}): ResolvedWorkspaceContext {
  const catalog = ensureWorkspaceCatalog(options);
  const activeWorkspace =
    catalog.workspaces.find((workspace) => workspace.id === catalog.activeWorkspaceId)
    ?? catalog.workspaces[0];
  if (!activeWorkspace) {
    throw new Error('Failed to resolve active workspace descriptor.');
  }

  return {
    catalogPath: resolveWorkspaceCatalogPath(options.stateRoot),
    catalog,
    activeWorkspaceId: activeWorkspace.id,
    activeWorkspace,
    workspaces: catalog.workspaces,
  };
}

export function resolveWorkspaceCatalogPath(stateRoot: string): string {
  return join(stateRoot, 'workspaces.catalog.json');
}

export function setActiveWorkspace(options: {
  workspaceRoot: string;
  stateRoot: string;
  workspaceId: string;
}): ResolvedWorkspaceContext {
  const resolved = resolveWorkspaceContext(options);
  if (!resolved.workspaces.some((workspace) => workspace.id === options.workspaceId)) {
    throw new Error(`Workspace not found: ${options.workspaceId}`);
  }

  const nextCatalog: WorkspaceCatalog = {
    ...resolved.catalog,
    activeWorkspaceId: options.workspaceId,
  };
  saveWorkspaceCatalog(resolved.catalogPath, nextCatalog);
  return resolveWorkspaceContext(options);
}

export function createWorkspaceDescriptor(options: {
  workspaceRoot: string;
  stateRoot: string;
  name: string;
  anchorRoot: string;
  repoRoots?: string[];
  nextId?: string;
  setActive?: boolean;
}): ResolvedWorkspaceContext {
  const resolved = resolveWorkspaceContext(options);
  const now = new Date().toISOString();
  const anchorRoot = resolve(options.anchorRoot);
  const repoRoots =
    options.repoRoots && options.repoRoots.length > 0 ?
      options.repoRoots.map((root) => resolve(root))
    : [anchorRoot];
  const nextWorkspace: WorkspaceDescriptor = {
    id: options.nextId ?? `workspace-${Date.now()}`,
    name: options.name.trim() || deriveDefaultWorkspaceName(anchorRoot),
    anchorRoot,
    repoRoots,
    stateRoot: resolve(options.stateRoot),
    createdAt: now,
    updatedAt: now,
  };
  const nextCatalog: WorkspaceCatalog = {
    ...resolved.catalog,
    activeWorkspaceId: options.setActive === false ? resolved.activeWorkspaceId : nextWorkspace.id,
    workspaces: [...resolved.workspaces, nextWorkspace],
  };
  saveWorkspaceCatalog(resolved.catalogPath, nextCatalog);
  return resolveWorkspaceContext(options);
}

function createDefaultWorkspaceCatalog(workspaceRoot: string, stateRoot: string): WorkspaceCatalog {
  const now = new Date().toISOString();
  return {
    version: 1,
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    workspaces: [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: deriveDefaultWorkspaceName(workspaceRoot),
        anchorRoot: workspaceRoot,
        repoRoots: [workspaceRoot],
        stateRoot,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

function deriveDefaultWorkspaceName(workspaceRoot: string): string {
  const name = basename(workspaceRoot);
  return name && name !== '/' ? name : 'Workspace';
}

export function readWorkspaceCatalog(catalogPath: string): WorkspaceCatalog {
  return JSON.parse(readFileSync(catalogPath, 'utf8')) as WorkspaceCatalog;
}

export function saveWorkspaceCatalog(catalogPath: string, catalog: WorkspaceCatalog) {
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

function normalizeWorkspaceCatalog(
  catalog: WorkspaceCatalog,
  workspaceRoot: string,
  stateRoot: string,
): WorkspaceCatalog {
  const fallback = createDefaultWorkspaceCatalog(workspaceRoot, stateRoot);
  const workspaces =
    Array.isArray(catalog.workspaces) && catalog.workspaces.length > 0 ?
      catalog.workspaces.map((workspace, index) => normalizeWorkspaceDescriptor(workspace, {
        fallbackId: index === 0 ? DEFAULT_WORKSPACE_ID : `workspace-${index + 1}`,
        workspaceRoot,
        stateRoot,
      }))
    : fallback.workspaces;
  const activeWorkspaceId =
    typeof catalog.activeWorkspaceId === 'string' && workspaces.some((workspace) => workspace.id === catalog.activeWorkspaceId) ?
      catalog.activeWorkspaceId
    : workspaces[0]?.id ?? DEFAULT_WORKSPACE_ID;

  return {
    version: 1,
    activeWorkspaceId,
    workspaces,
  };
}

function normalizeWorkspaceDescriptor(
  workspace: Partial<WorkspaceDescriptor>,
  options: { fallbackId: string; workspaceRoot: string; stateRoot: string },
): WorkspaceDescriptor {
  const now = new Date().toISOString();
  const anchorRoot = resolve(workspace.anchorRoot ?? options.workspaceRoot);
  const repoRoots =
    Array.isArray(workspace.repoRoots) && workspace.repoRoots.length > 0 ?
      workspace.repoRoots.map((root) => resolve(root))
    : [anchorRoot];

  return {
    id: typeof workspace.id === 'string' && workspace.id.trim() ? workspace.id : options.fallbackId,
    name:
      typeof workspace.name === 'string' && workspace.name.trim() ?
        workspace.name
      : deriveDefaultWorkspaceName(anchorRoot),
    anchorRoot,
    repoRoots,
    stateRoot: resolve(workspace.stateRoot ?? options.stateRoot),
    createdAt: workspace.createdAt ?? now,
    updatedAt: workspace.updatedAt ?? now,
  };
}
