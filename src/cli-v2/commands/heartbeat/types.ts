import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';

export type HeartbeatCliOptions = {
  model?: string;
  maxSteps?: number;
  workspaceRoot?: string;
  activeWorkspaceId?: string;
  stateDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  preferApiKey?: boolean;
  runtimeHost?: ResolvedRuntimeHost;
  forceOwnerConflict?: boolean;
};

export type HeartbeatCliContext = {
  client: ControlPlaneProxyClient;
  workspaceId: string;
  options: HeartbeatCliOptions;
};
