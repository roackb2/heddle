import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { ConversationCompactionStatus } from '@/core/live/index.js';
import type { TraceSummaryService } from '@/core/observability/index.js';
import type { RunAgentLoopOptions } from '@/core/runtime/loop/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { ChatTurnHostPort } from './host/index.js';
import type { ToolDefinition } from '@/core/types.js';

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
  tools?: ToolDefinition[];
  agentProfileId?: string;
  agentSnapshot?: CustomAgentExecutionSnapshot;
  traceSummarizerRegistry?: TraceSummaryService;
  onCompactionStatus?: (event: ConversationCompactionStatus) => void;
  onTraceEvent?: RunAgentLoopOptions['onTraceEvent'];
  shouldStop?: RunAgentLoopOptions['shouldStop'];
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
  | 'tools'
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
  | 'agentProfileId'
  | 'agentSnapshot'
>;

export type TurnHostInput = Pick<
  RunConversationTurnArgs,
  'host' | 'onTraceEvent' | 'shouldStop'
>;

export type TurnPreflightInput = Pick<
  RunConversationTurnArgs,
  'sessionStoragePath' | 'stateRoot' | 'prompt'
>;

export type AgentLoopTurnInput = Pick<
  RunConversationTurnArgs,
  'prompt' | 'maxSteps' | 'workspaceRoot' | 'stateRoot' | 'onTraceEvent' | 'approvalPolicies' | 'shouldStop' | 'abortSignal'
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
