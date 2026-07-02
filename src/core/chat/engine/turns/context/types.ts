import type { ArtifactRepository } from '@/core/artifacts/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkit } from '@/core/tools/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { ChatTurnRuntime } from '../runtime/index.js';

export type PrepareConversationTurnContextArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionRepository: ChatSessionRepository;
  sessionId: string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  tools?: ToolDefinition[];
  toolkits?: ToolToolkit[];
  hiddenMcpServerIds?: string[];
  artifactRoot: string;
  artifactRepository?: ArtifactRepository;
  artifactsEnabled: boolean;
  agentSnapshot?: CustomAgentExecutionSnapshot;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  leaseOwner?: ChatSessionLeaseOwner;
};

export type ConversationTurnToolContextArgs = Pick<
  PrepareConversationTurnContextArgs,
  | 'workspaceRoot'
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
  | 'sessionId'
>;

export type ConversationTurnToolRuntimeArgs = Pick<
  ChatTurnRuntime,
  'model' | 'apiKey' | 'providerCredentialSource' | 'memoryDir'
>;

export type ConversationTurnContext = {
  sessions: ChatSession[];
  session: ChatSession;
  runtime: ChatTurnRuntime;
  agentSnapshot?: CustomAgentExecutionSnapshot;
  tools: ToolDefinition[];
  toolNames: string[];
  leaseOwner: ChatSessionLeaseOwner;
};
