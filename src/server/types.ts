import type { Logger } from 'pino';
import type { ControlPlaneServerRecord } from '@/core/runtime/daemon/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';

export type HeddleServerOptions = {
  workspaceRoot: string;
  stateRoot: string;
  preferApiKey?: boolean;
  assetsDir?: string;
  serveAssets?: boolean;
  logger?: Logger;
  runtimeHost?: HeddleRuntimeHostDescriptor;
};

export type HeddleControlPlaneServerOptions = Omit<HeddleServerOptions, 'runtimeHost'> & {
  mode: ControlPlaneServerRecord['mode'];
  host: string;
  port: number;
  daemonRegistryPath?: string;
  serverId?: string;
};

export type HeddleRuntimeHostDescriptor = {
  mode: ControlPlaneServerRecord['mode'];
  serverId: string;
  registryPath: string;
  endpoint: {
    host: string;
    port: number;
  };
  startedAt: string;
};

export type HeddleRuntimeHostInfo = HeddleRuntimeHostDescriptor;

export type HeddleControlPlaneServerHandle = {
  mode: ControlPlaneServerRecord['mode'];
  serverId: string;
  host: string;
  port: number;
  endpoint: {
    host: string;
    port: number;
  };
  registryPath: string;
  workspaceRoot: string;
  stateRoot: string;
  startedAt: string;
  close: () => Promise<void>;
};

export type HeddleServerContext = {
  workspaceRoot: string;
  stateRoot: string;
  preferApiKey: boolean;
  activeWorkspaceId: string;
  activeWorkspace: WorkspaceDescriptor;
  workspaces: WorkspaceDescriptor[];
  runtimeHost: HeddleRuntimeHostInfo | null;
  logger: Logger;
};
