export const DEFAULT_WORKSPACE_ID = 'default';

export type WorkspaceDescriptor = {
  id: string;
  name: string;
  workspaceRoot: string;
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

export type WorkspaceRootConfig = {
  workspaceRoot: string;
  stateRoot: string;
};

export type CreateWorkspaceDescriptorInput = WorkspaceRootConfig & {
  name: string;
  newWorkspaceRoot: string;
  repoRoots?: string[];
  nextId?: string;
  setActive?: boolean;
  workspaceStateRoot?: string;
};

export type RenameWorkspaceDescriptorInput = WorkspaceRootConfig & {
  workspaceId: string;
  name: string;
};

export type SetActiveWorkspaceInput = WorkspaceRootConfig & {
  workspaceId: string;
};
