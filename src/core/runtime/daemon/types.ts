import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';

export type DaemonOwnerRecord = {
  ownerId: string;
  mode: 'daemon';
  host: string;
  port: number;
  pid: number;
  startedAt: string;
  lastSeenAt: string;
  workspaceRoot: string;
  stateRoot: string;
};

export type RegisteredWorkspaceRecord = {
  workspace: WorkspaceDescriptor;
  owner?: DaemonOwnerRecord;
  updatedAt: string;
};

export type DaemonRegistry = {
  version: 1;
  updatedAt: string;
  workspaces: RegisteredWorkspaceRecord[];
};

export type UpsertDaemonWorkspaceRegistrationInput = {
  registryPath: string;
  workspaces: WorkspaceDescriptor[];
  owner: Omit<DaemonOwnerRecord, 'lastSeenAt'> & { lastSeenAt?: string };
};

export type ClearDaemonWorkspaceRegistrationInput = {
  registryPath: string;
  workspaceIds: string[];
  stateRoots?: string[];
  ownerId: string;
};

export type RegisterKnownWorkspacesInput = {
  registryPath?: string;
  workspaces: WorkspaceDescriptor[];
};

export type ResolveRuntimeHostInput = {
  workspaceRoot: string;
  stateRoot: string;
  registryPath?: string;
  now?: number;
  staleAfterMs?: number;
  isPidAlive?: (pid: number) => boolean;
};

export type ResolvedRuntimeHost =
  | {
      kind: 'none';
      registryPath: string;
      workspaceId: string;
    }
  | {
      kind: 'daemon';
      registryPath: string;
      workspaceId: string;
      ownerId: string;
      endpoint: {
        host: string;
        port: number;
      };
      startedAt: string;
      lastSeenAt: string;
      stale: boolean;
      ageMs: number;
    };
