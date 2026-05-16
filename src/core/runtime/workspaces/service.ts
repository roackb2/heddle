/**
 * Runtime workspace service.
 *
 * Owns workspace catalog semantics: default catalog creation, descriptor
 * normalization, active workspace selection, creation, and renaming. Host code
 * should call this service instead of touching workspace catalog files.
 */
import { basename, join, resolve } from 'node:path';
import { FileWorkspaceRepository } from './repository.js';
import { WorkspaceCatalogReadSchema } from './schemas.js';
import {
  DEFAULT_WORKSPACE_ID,
  type CreateWorkspaceDescriptorInput,
  type RenameWorkspaceDescriptorInput,
  type ResolvedWorkspaceContext,
  type SetActiveWorkspaceInput,
  type WorkspaceCatalog,
  type WorkspaceDescriptor,
  type WorkspaceRootConfig,
} from './types.js';

export class RuntimeWorkspaceService {
  static ensureCatalog(config: WorkspaceRootConfig): WorkspaceCatalog {
    const workspaceRoot = resolve(config.workspaceRoot);
    const stateRoot = resolve(config.stateRoot);
    const repository = FileWorkspaceRepository.forStateRoot(stateRoot);

    if (!repository.exists()) {
      const catalog = RuntimeWorkspaceService.createDefaultCatalog({ workspaceRoot, stateRoot });
      repository.save(catalog);
      return catalog;
    }

    const raw = repository.readRaw();
    const normalized = RuntimeWorkspaceService.normalizeCatalog({ raw, workspaceRoot, stateRoot });
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      repository.save(normalized);
    }
    return normalized;
  }

  static resolveContext(config: WorkspaceRootConfig): ResolvedWorkspaceContext {
    const catalog = RuntimeWorkspaceService.ensureCatalog(config);
    const activeWorkspace =
      catalog.workspaces.find((workspace) => workspace.id === catalog.activeWorkspaceId)
      ?? catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('Failed to resolve active workspace descriptor.');
    }

    return {
      catalogPath: FileWorkspaceRepository.resolveCatalogPath(config.stateRoot),
      catalog,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: catalog.workspaces,
    };
  }

  static setActive(input: SetActiveWorkspaceInput): ResolvedWorkspaceContext {
    const resolved = RuntimeWorkspaceService.resolveContext(input);
    if (!resolved.workspaces.some((workspace) => workspace.id === input.workspaceId)) {
      throw new Error(`Workspace not found: ${input.workspaceId}`);
    }

    RuntimeWorkspaceService.saveResolvedCatalog(resolved, {
      ...resolved.catalog,
      activeWorkspaceId: input.workspaceId,
    });
    return RuntimeWorkspaceService.resolveContext(input);
  }

  static rename(input: RenameWorkspaceDescriptorInput): ResolvedWorkspaceContext {
    const resolved = RuntimeWorkspaceService.resolveContext(input);
    const name = input.name.trim();
    if (!name) {
      throw new Error('Workspace name is required.');
    }
    if (!resolved.workspaces.some((workspace) => workspace.id === input.workspaceId)) {
      throw new Error(`Workspace not found: ${input.workspaceId}`);
    }

    const now = new Date().toISOString();
    RuntimeWorkspaceService.saveResolvedCatalog(resolved, {
      ...resolved.catalog,
      workspaces: resolved.workspaces.map((workspace) => (
        workspace.id === input.workspaceId ? { ...workspace, name, updatedAt: now } : workspace
      )),
    });
    return RuntimeWorkspaceService.resolveContext(input);
  }

  static createDescriptor(input: CreateWorkspaceDescriptorInput): ResolvedWorkspaceContext {
    const resolved = RuntimeWorkspaceService.resolveContext(input);
    const now = new Date().toISOString();
    const anchorRoot = resolve(input.anchorRoot);
    const workspaceStateRoot = resolve(input.workspaceStateRoot ?? join(anchorRoot, basename(input.stateRoot)));
    const existing = resolved.workspaces.find((workspace) => (
      resolve(workspace.stateRoot) === workspaceStateRoot || resolve(workspace.anchorRoot) === anchorRoot
    ));

    if (existing) {
      RuntimeWorkspaceService.saveResolvedCatalog(resolved, {
        ...resolved.catalog,
        activeWorkspaceId: input.setActive === false ? resolved.activeWorkspaceId : existing.id,
        workspaces: resolved.workspaces,
      });
      return RuntimeWorkspaceService.resolveContext(input);
    }

    const repoRoots =
      input.repoRoots && input.repoRoots.length > 0 ?
        input.repoRoots.map((root) => resolve(root))
      : [anchorRoot];
    const nextWorkspace: WorkspaceDescriptor = {
      id: input.nextId ?? `workspace-${Date.now()}`,
      name: input.name.trim() || RuntimeWorkspaceService.deriveDefaultWorkspaceName(anchorRoot),
      anchorRoot,
      repoRoots,
      stateRoot: workspaceStateRoot,
      createdAt: now,
      updatedAt: now,
    };
    RuntimeWorkspaceService.saveResolvedCatalog(resolved, {
      ...resolved.catalog,
      activeWorkspaceId: input.setActive === false ? resolved.activeWorkspaceId : nextWorkspace.id,
      workspaces: [...resolved.workspaces, nextWorkspace],
    });
    return RuntimeWorkspaceService.resolveContext(input);
  }

  static readCatalog(catalogPath: string, config: WorkspaceRootConfig): WorkspaceCatalog {
    const repository = new FileWorkspaceRepository({ catalogPath });
    return RuntimeWorkspaceService.normalizeCatalog({
      raw: repository.readRaw(),
      workspaceRoot: resolve(config.workspaceRoot),
      stateRoot: resolve(config.stateRoot),
    });
  }

  private static saveResolvedCatalog(resolved: ResolvedWorkspaceContext, catalog: WorkspaceCatalog): void {
    new FileWorkspaceRepository({ catalogPath: resolved.catalogPath }).save(catalog);
  }

  private static createDefaultCatalog(config: WorkspaceRootConfig): WorkspaceCatalog {
    const now = new Date().toISOString();
    return {
      version: 1,
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      workspaces: [
        {
          id: DEFAULT_WORKSPACE_ID,
          name: RuntimeWorkspaceService.deriveDefaultWorkspaceName(config.workspaceRoot),
          anchorRoot: config.workspaceRoot,
          repoRoots: [config.workspaceRoot],
          stateRoot: config.stateRoot,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
  }

  private static deriveDefaultWorkspaceName(workspaceRoot: string): string {
    const name = basename(workspaceRoot);
    return name && name !== '/' ? name : 'Workspace';
  }

  private static normalizeCatalog(args: {
    raw: unknown;
    workspaceRoot: string;
    stateRoot: string;
  }): WorkspaceCatalog {
    const fallback = RuntimeWorkspaceService.createDefaultCatalog(args);
    const parsed = WorkspaceCatalogReadSchema.safeParse(args.raw);
    if (!parsed.success) {
      return fallback;
    }

    const workspaces =
      parsed.data.workspaces && parsed.data.workspaces.length > 0 ?
        parsed.data.workspaces.map((workspace, index) => RuntimeWorkspaceService.normalizeDescriptor(workspace, {
          fallbackId: index === 0 ? DEFAULT_WORKSPACE_ID : `workspace-${index + 1}`,
          workspaceRoot: args.workspaceRoot,
          stateRoot: args.stateRoot,
        }))
      : fallback.workspaces;
    const activeWorkspaceId =
      parsed.data.activeWorkspaceId && workspaces.some((workspace) => workspace.id === parsed.data.activeWorkspaceId) ?
        parsed.data.activeWorkspaceId
      : workspaces[0]?.id ?? DEFAULT_WORKSPACE_ID;

    return {
      version: 1,
      activeWorkspaceId,
      workspaces,
    };
  }

  private static normalizeDescriptor(
    workspace: Partial<WorkspaceDescriptor>,
    options: { fallbackId: string; workspaceRoot: string; stateRoot: string },
  ): WorkspaceDescriptor {
    const now = new Date().toISOString();
    const anchorRoot = resolve(workspace.anchorRoot ?? options.workspaceRoot);
    const stateRoot = resolve(workspace.stateRoot ?? join(anchorRoot, basename(options.stateRoot)));
    const repoRoots =
      workspace.repoRoots && workspace.repoRoots.length > 0 ?
        workspace.repoRoots.map((root) => resolve(root))
      : [anchorRoot];

    return {
      id: workspace.id?.trim() || options.fallbackId,
      name: workspace.name?.trim() || RuntimeWorkspaceService.deriveDefaultWorkspaceName(anchorRoot),
      anchorRoot,
      repoRoots,
      stateRoot,
      createdAt: workspace.createdAt ?? now,
      updatedAt: workspace.updatedAt ?? now,
    };
  }
}
