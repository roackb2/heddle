import type { ProviderCredentialSource } from '@/core/runtime/credentials/index.js';
import type { RuntimeToolSelectionProfile } from './profiles/index.js';
import type { ToolDefinition } from '@/core/types.js';

export type DefaultAgentToolsOptions = {
  model: string;
  apiKey?: string;
  providerCredentialSource?: ProviderCredentialSource;
  credentialStorePath?: string;
  workspaceRoot?: string;
  stateDir?: string;
  stateRoot?: string;
  memoryDir?: string;
  memoryMode?: 'none' | 'read-and-record' | 'maintainer' | 'legacy-full';
  tools?: ToolDefinition[];
  toolProfile?: RuntimeToolSelectionProfile;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
};
