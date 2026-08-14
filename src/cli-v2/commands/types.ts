import type { ResolvedRuntimeHost } from '@heddleagent/runtime/cli';

export type CliV2CommandEdgeOptions = {
  workspaceRoot: string;
  activeWorkspaceId: string;
  model?: string;
  maxSteps?: number;
  preferApiKey: boolean;
  stateDir: string;
  directShellApproval: 'always' | 'never';
  searchIgnoreDirs: string[];
  systemContext?: string;
  runtimeHost: ResolvedRuntimeHost;
  forceOwnerConflict: boolean;
};
