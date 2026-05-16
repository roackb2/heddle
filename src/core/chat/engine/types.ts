import type { ToolApprovalPolicy, ToolApprovalSurface } from '../../approvals/types.js';
import type {
  ConversationActivity,
  ConversationCompactionStatus,
} from '../../observability/conversation-activity.js';
import type { TraceSummarizerRegistry } from '../../observability/trace-summarizers.js';
import type { AgentLoopEvent, RunAgentLoopOptions } from '../../runtime/agent-loop.js';
import type { ChatMessage, ReasoningEffort } from '../../llm/types.js';
import type { TraceEvent } from '../../types.js';
import type { ChatSessionLeaseOwner } from './sessions/leases/index.js';
import type { ChatSession, ChatSessionRetention } from '../types.js';
import type { ChatTurnHostPort } from './turns/host/index.js';
import type { ConversationCompactionResult } from '@/core/chat/engine/compaction/index.js';

export type ConversationEngineConfig = {
  workspaceRoot: string;
  stateRoot: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
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
  // Reads
  list(): ChatSession[];
  // Reads persisted sessions without materializing the host-facing fallback.
  listExisting(): ChatSession[];
  read(id: string): ChatSession | undefined;
  require(id: string): ChatSession;
  latest(): ChatSession | undefined;
  latestExisting(): ChatSession | undefined;

  // Lifecycle
  create(input?: CreateConversationSessionInput): ChatSession;
  createOneOff(input?: CreateConversationSessionInput): ChatSession;
  rename(id: string, name: string): ChatSession;
  delete(id: string): boolean;

  // Generic mutation escape hatch
  update(id: string, updater: (session: ChatSession) => ChatSession): ChatSession | undefined;

  // Settings
  updateSettings(id: string, input: UpdateConversationSessionSettingsInput): ChatSession;
  setDriftEnabled(id: string, enabled: boolean): ChatSession;

  // Messages
  appendMessage(id: string, input: AppendConversationMessageInput): ChatSession;
  appendMessages(id: string, inputs: AppendConversationMessageInput[]): ChatSession;

  // Conversation state
  resetConversation(id: string, input: ResetConversationSessionInput): ChatSession;
  setLastContinuePrompt(id: string, prompt: string | undefined): ChatSession;

  // Compaction state
  markCompactionRunning(id: string, input: MarkConversationCompactionRunningInput): ChatSession;
  applyCompactionResult(id: string, input: ApplyConversationCompactionResultInput): ChatSession;
  restoreCompactionState(id: string, input: RestoreConversationCompactionStateInput): ChatSession;

  // Leases
  getLeaseConflict(id: string, owner: ChatSessionLeaseOwner): string | undefined;
  acquireLease(id: string, owner: ChatSessionLeaseOwner): ChatSession;
  releaseLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): ChatSession;
};

export type CreateConversationSessionInput = {
  id?: string;
  name?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  workspaceId?: string;
  apiKeyPresent?: boolean;
  retention?: ChatSessionRetention;
};

export type UpdateConversationSessionSettingsInput = {
  model?: string;
  reasoningEffort?: ReasoningEffort | null;
  driftEnabled?: boolean;
};

export type AppendConversationMessageInput = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
  isPending?: boolean;
};

export type ResetConversationSessionInput = {
  apiKeyPresent: boolean;
};

export type MarkConversationCompactionRunningInput = {
  sourceHistory: ChatMessage[];
  archivePath?: string;
};

export type ApplyConversationCompactionResultInput = ConversationCompactionResult;

export type RestoreConversationCompactionStateInput = Pick<ChatSession, 'context' | 'archives'>;

export type ConversationTurnService = {
  submit(input: SubmitConversationTurnInput): Promise<SubmitConversationTurnResult>;
  continue(input: ContinueConversationTurnInput): Promise<SubmitConversationTurnResult>;
  clearLease(input: ClearConversationTurnLeaseInput): void;
};

export type SubmitConversationTurnInput = {
  sessionId: string;
  prompt: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  host?: ConversationEngineHost;
  abortSignal?: AbortSignal;
  shouldStop?: RunAgentLoopOptions['shouldStop'];
  leaseOwner?: ChatSessionLeaseOwner;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  approvalPolicies?: ToolApprovalPolicy[];
  traceSummarizerRegistry?: TraceSummarizerRegistry;
};

export type ContinueConversationTurnInput = {
  sessionId: string;
  prompt?: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  host?: ConversationEngineHost;
  abortSignal?: AbortSignal;
  shouldStop?: RunAgentLoopOptions['shouldStop'];
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
    onPreflightCompactionStatus?: (event: ConversationCompactionStatus) => void;
    onFinalCompactionStatus?: (event: ConversationCompactionStatus) => void;
  };
  assistant?: {
    onStream?: RunAgentLoopOptions['onAssistantStream'];
    onText?: (text: string) => void;
  };
  trace?: {
    onEvent?: (event: TraceEvent) => void;
  };
};

export type NormalizedConversationEngineHost = {
  turnHost?: ChatTurnHostPort;
  onAssistantStream?: RunAgentLoopOptions['onAssistantStream'];
  onTraceEvent?: RunAgentLoopOptions['onTraceEvent'];
};
