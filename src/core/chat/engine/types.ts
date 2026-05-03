import type { ToolApprovalPolicy, ToolApprovalSurface } from '../../approvals/types.js';
import type {
  ConversationActivity,
  ConversationCompactionStatus,
} from '../../observability/conversation-activity.js';
import type { TraceSummarizerRegistry } from '../../observability/trace-summarizers.js';
import type { AgentLoopEvent, RunAgentLoopOptions } from '../../runtime/agent-loop.js';
import type { TraceEvent } from '../../types.js';
import type { ChatSessionLeaseOwner } from '../session-lease.js';
import type { ChatSession } from '../types.js';

export type ConversationEngineConfig = {
  workspaceRoot: string;
  stateRoot: string;
  model: string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  traceSummarizerRegistry?: TraceSummarizerRegistry;
  approvalPolicies?: ToolApprovalPolicy[];
  sessionStoragePath?: string;
  memoryDir?: string;
  workspaceId?: string;
  apiKeyPresent?: boolean;
};

export type ConversationEngine = {
  sessions: ConversationSessionService;
  turns: ConversationTurnService;
};

export type ConversationSessionService = {
  list(): ChatSession[];
  read(id: string): ChatSession | undefined;
  create(input?: CreateConversationSessionInput): ChatSession;
  rename(id: string, name: string): ChatSession;
  delete(id: string): boolean;
};

export type CreateConversationSessionInput = {
  id?: string;
  name?: string;
  model?: string;
  workspaceId?: string;
  apiKeyPresent?: boolean;
};

export type ConversationTurnService = {
  submit(input: SubmitConversationTurnInput): Promise<SubmitConversationTurnResult>;
  continue(input: ContinueConversationTurnInput): Promise<SubmitConversationTurnResult>;
  clearLease(input: ClearConversationTurnLeaseInput): void;
};

export type SubmitConversationTurnInput = {
  sessionId: string;
  prompt: string;
  host?: ConversationEngineHost;
  abortSignal?: AbortSignal;
  leaseOwner?: ChatSessionLeaseOwner;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  approvalPolicies?: ToolApprovalPolicy[];
  traceSummarizerRegistry?: TraceSummarizerRegistry;
};

export type ContinueConversationTurnInput = {
  sessionId: string;
  prompt?: string;
  host?: ConversationEngineHost;
  abortSignal?: AbortSignal;
  leaseOwner?: ChatSessionLeaseOwner;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  approvalPolicies?: ToolApprovalPolicy[];
  traceSummarizerRegistry?: TraceSummarizerRegistry;
};

export type ClearConversationTurnLeaseInput = {
  sessionId: string;
  owner: ChatSessionLeaseOwner;
};

export type SubmitConversationTurnResult = {
  outcome: string;
  summary: string;
  session: ChatSession;
};

export type ConversationEngineHost = {
  events?: {
    onActivity?: (activity: ConversationActivity) => void;
    onAgentLoopEvent?: (event: AgentLoopEvent) => void;
  };
  approvals?: {
    requestToolApproval?: ToolApprovalSurface;
  };
  compaction?: {
    onStatus?: (event: ConversationCompactionStatus) => void;
  };
  assistant?: {
    onText?: (text: string) => void;
  };
  trace?: {
    onEvent?: (event: TraceEvent) => void;
  };
};

export type NormalizedConversationEngineHost = {
  turnHost?: {
    events?: {
      onAgentLoopEvent?: (event: AgentLoopEvent) => void;
    };
    approvals?: {
      requestToolApproval?: ToolApprovalSurface;
    };
    compaction?: {
      onPreflightCompactionStatus?: (event: ConversationCompactionStatus) => void;
      onFinalCompactionStatus?: (event: ConversationCompactionStatus) => void;
    };
  };
  onAssistantStream?: RunAgentLoopOptions['onAssistantStream'];
  onTraceEvent?: RunAgentLoopOptions['onTraceEvent'];
  onCompactionStatus?: (event: ConversationCompactionStatus) => void;
};
