import type { Logger } from 'pino';
import type { DaemonOwnerRecord } from '../core/runtime/daemon-registry.js';
import type { WorkspaceDescriptor } from '../core/runtime/workspaces.js';

export type HeddleServerOptions = {
  workspaceRoot: string;
  stateRoot: string;
  assetsDir?: string;
  logger?: Logger;
  runtimeHost?: HeddleRuntimeHostDescriptor;
};

export type HeddleServerListenOptions = HeddleServerOptions & {
  host: string;
  port: number;
  daemonRegistryPath?: string;
};

export type HeddleRuntimeHostDescriptor = {
  mode: 'daemon';
  ownerId: string;
  registryPath: string;
  endpoint: {
    host: string;
    port: number;
  };
  startedAt: string;
};

export type HeddleRuntimeHostInfo = HeddleRuntimeHostDescriptor & {
  workspaceOwner: DaemonOwnerRecord | null;
};

export type HeddleServerContext = {
  workspaceRoot: string;
  stateRoot: string;
  activeWorkspaceId: string;
  activeWorkspace: WorkspaceDescriptor;
  workspaces: WorkspaceDescriptor[];
  runtimeHost: HeddleRuntimeHostInfo | null;
  logger: Logger;
};
