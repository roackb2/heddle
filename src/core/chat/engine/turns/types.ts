import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import type { ConversationCompactionStatus } from '@/core/observability/conversation-activity.js';
import type { TraceSummarizerRegistry } from '@/core/observability/trace-summarizers.js';
import type { runAgentLoop } from '@/core/runtime/agent-loop.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { ChatTurnHostPort } from './host/index.js';

export type RunConversationTurnArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  sessionId: string;
  prompt: string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  traceDir: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  host?: ChatTurnHostPort;
  approvalPolicies?: ToolApprovalPolicy[];
  traceSummarizerRegistry?: TraceSummarizerRegistry;
  onCompactionStatus?: (event: ConversationCompactionStatus) => void;
  onAssistantStream?: Parameters<typeof runAgentLoop>[0]['onAssistantStream'];
  onTraceEvent?: Parameters<typeof runAgentLoop>[0]['onTraceEvent'];
  shouldStop?: Parameters<typeof runAgentLoop>[0]['shouldStop'];
  abortSignal?: AbortSignal;
  leaseOwner?: ChatSessionLeaseOwner;
};

export type TurnRuntimeConfigInput = Pick<
  RunConversationTurnArgs,
  | 'workspaceRoot'
  | 'stateRoot'
  | 'sessionStoragePath'
  | 'apiKey'
  | 'preferApiKey'
  | 'credentialStorePath'
  | 'systemContext'
  | 'traceDir'
  | 'memoryMaintenanceMode'
  | 'approvalPolicies'
  | 'traceSummarizerRegistry'
>;

export type TurnSubmitInput = Pick<
  RunConversationTurnArgs,
  | 'sessionId'
  | 'prompt'
  | 'maxSteps'
  | 'searchIgnoreDirs'
  | 'includePlanTool'
  | 'abortSignal'
  | 'leaseOwner'
>;

export type TurnHostInput = Pick<
  RunConversationTurnArgs,
  'host' | 'onAssistantStream' | 'onTraceEvent' | 'shouldStop'
>;

export type TurnPreflightInput = Pick<
  RunConversationTurnArgs,
  'sessionStoragePath' | 'stateRoot' | 'prompt'
>;

export type AgentLoopTurnInput = Pick<
  RunConversationTurnArgs,
  'prompt' | 'maxSteps' | 'workspaceRoot' | 'stateRoot' | 'onAssistantStream' | 'onTraceEvent' | 'approvalPolicies' | 'shouldStop' | 'abortSignal'
>;

export type TurnPersistenceInput = Pick<
  RunConversationTurnArgs,
  'sessionStoragePath' | 'stateRoot' | 'traceDir' | 'traceSummarizerRegistry' | 'prompt'
>;

export type RunConversationTurnResult = {
  outcome: string;
  summary: string;
  session: ChatSession;
};
