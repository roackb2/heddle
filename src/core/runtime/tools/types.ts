import type { ArtifactRepository } from '@/core/artifacts/index.js';
import type { MemoryToolMode } from '@/core/memory/tool-mode.js';
import type {
  ProviderCredentialSource,
  ResolvedProviderCredential,
} from '@/core/runtime/credentials/index.js';
import type { RuntimeToolSelectionProfile } from './profiles/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkit } from '@/core/tools/index.js';

export type DefaultAgentToolsOptions = {
  model: string;
  apiKey?: string;
  credential?: ResolvedProviderCredential;
  providerCredentialSource?: ProviderCredentialSource;
  credentialStorePath?: string;
  workspaceRoot?: string;
  stateDir?: string;
  stateRoot?: string;
  artifactRoot?: string;
  artifactRepository?: ArtifactRepository;
  artifactsEnabled?: boolean;
  sessionId?: string;
  memoryDir?: string;
  memoryMode?: MemoryToolMode;
  tools?: ToolDefinition[];
  toolkits?: ToolToolkit[];
  hiddenMcpServerIds?: string[];
  toolProfile?: RuntimeToolSelectionProfile;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  includeDefaultTools?: boolean;
};
