import type { ArtifactRepository } from '@/core/artifacts/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkit } from '@/core/tools/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { ConversationSessionService } from '@/core/chat/engine/types.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { ChatTurnRuntime } from '../runtime/index.js';
import type { RuntimeToolSelectionProfile } from '@/core/runtime/tools/index.js';
import type { RuntimeProviderCredential } from '@/core/runtime/credentials/index.js';

export type PrepareConversationTurnContextArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionService: ConversationSessionService;
  sessionId: string;
  apiKey?: string;
  credential?: RuntimeProviderCredential;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  tools?: ToolDefinition[];
  toolkits?: ToolToolkit[];
  hiddenMcpServerIds?: string[];
  artifactRoot: string;
  artifactRepository?: ArtifactRepository;
  artifactsEnabled: boolean;
  toolProfile?: RuntimeToolSelectionProfile;
  agentSnapshot?: CustomAgentExecutionSnapshot;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  leaseOwner?: ChatSessionLeaseOwner;
};

export type ConversationTurnToolContextArgs = Pick<
  PrepareConversationTurnContextArgs,
  | 'workspaceRoot'
  | 'credential'
  | 'credentialStorePath'
  | 'searchIgnoreDirs'
  | 'includePlanTool'
  | 'stateRoot'
  | 'tools'
  | 'toolkits'
  | 'hiddenMcpServerIds'
  | 'artifactRoot'
  | 'artifactRepository'
  | 'artifactsEnabled'
  | 'toolProfile'
  | 'sessionId'
>;

export type ConversationTurnToolRuntimeArgs = Pick<
  ChatTurnRuntime,
  'model' | 'apiKey' | 'credential' | 'providerCredentialSource' | 'memoryDir'
>;

export type ConversationTurnContext = {
  session: ChatSession;
  runtime: ChatTurnRuntime;
  agentSnapshot?: CustomAgentExecutionSnapshot;
  tools: ToolDefinition[];
  toolNames: string[];
  leaseOwner: ChatSessionLeaseOwner;
};
