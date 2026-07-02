import type { ToolApprovalPolicy, ToolApprovalSurface } from '../../approvals/types.js';
import type {
  ConversationActivity,
  ConversationCompactionStatus,
} from '@/core/live/index.js';
import type {
  TraceSummaryService,
} from '@/core/observability/index.js';
import type { AgentLoopEvent, RunAgentLoopOptions } from '../../runtime/loop/index.js';
import type { ChatMessage, LlmAdapter, ReasoningEffort } from '../../llm/types.js';
import type { ToolDefinition, TraceEvent } from '../../types.js';
import type { ChatSessionLeaseOwner } from './sessions/leases/index.js';
import type { ChatSession, ChatSessionRetention, QueuedConversationPrompt } from '../types.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { ChatTurnHostPort } from './turns/host/index.js';
import type { ConversationTurnResultSummary } from './turn-result.js';
import type { ConversationCompactionResult } from '@/core/chat/engine/compaction/index.js';
import type {
  ConversationEngineHostExtension,
  ConversationEngineHostExtensionBundle,
  ConversationEngineHostExtensionInput,
} from './host-extension.js';

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
  traceSummarizerRegistry?: TraceSummaryService;
  approvalPolicies?: ToolApprovalPolicy[];
  hostExtensions?: ConversationEngineHostExtensionsInput;
  /**
   * @deprecated Prefer hostExtensions.tools for new programmatic hosts.
   */
  tools?: ToolDefinition[];
  sessionStoragePath?: string;
  memoryDir?: string;
  workspaceId?: string;
  apiKeyPresent?: boolean;
};

export type ConversationEngineHostExtensions = ConversationEngineHostExtensionBundle;
export type ConversationEngineHostExtensionsInput = ConversationEngineHostExtensionInput;
export type { ConversationEngineHostExtension };

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
  setPinned(id: string, pinned: boolean): ChatSession;
  setArchived(id: string, archived: boolean): ChatSession;
  autoRenameAfterFirstUserMessage(id: string, input: AutoRenameConversationSessionInput): Promise<AutoRenameConversationSessionResult>;
  delete(id: string): boolean;

  // Generic mutation escape hatch
  update(id: string, updater: (session: ChatSession) => ChatSession): ChatSession | undefined;

  // Settings
  updateSettings(id: string, input: UpdateConversationSessionSettingsInput): ChatSession;
  setDriftEnabled(id: string, enabled: boolean): ChatSession;

  // Messages
  appendMessage(id: string, input: AppendConversationMessageInput): ChatSession;
  appendMessages(id: string, inputs: AppendConversationMessageInput[]): ChatSession;
  acceptUserMessage(id: string, input: AcceptConversationUserMessageInput): ChatSession;
  markAcceptedUserMessage(id: string, input: MarkAcceptedConversationUserMessageInput): ChatSession;
  markAcceptedUserMessageFailed(id: string, input: MarkAcceptedConversationUserMessageFailedInput): ChatSession;
  enqueuePrompt(id: string, input: EnqueueConversationPromptInput): QueuedConversationPromptResult;
  updateQueuedPrompt(id: string, input: UpdateQueuedConversationPromptInput): ChatSession;
  deleteQueuedPrompt(id: string, input: DeleteQueuedConversationPromptInput): ChatSession;
  dequeueQueuedPrompt(id: string): DequeuedConversationPromptResult;

  // Conversation state
  resetConversation(id: string): ChatSession;
  setLastContinuePrompt(id: string, prompt: string | undefined): ChatSession;

  // Compaction state
  markCompactionRunning(id: string, input: MarkConversationCompactionRunningInput): ChatSession;
  applyCompactionResult(id: string, input: ApplyConversationCompactionResultInput): ChatSession;
  restoreCompactionState(id: string, input: RestoreConversationCompactionStateInput): ChatSession;

  // Leases
  getLeaseConflict(id: string, owner: ChatSessionLeaseOwner): string | undefined;
  acquireLease(id: string, owner: ChatSessionLeaseOwner): ChatSession;
  refreshLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): ChatSession;
  releaseLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): ChatSession;
};

export type CreateConversationSessionInput = {
  id?: string;
  name?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  workspaceId?: string;
  retention?: ChatSessionRetention;
};

export type AutoRenameConversationSessionInput = {
  llm: LlmAdapter;
  prompt: string;
  responseText: string;
};

export type AutoRenameConversationSessionResult = {
  renamed: boolean;
  session?: ChatSession;
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

export type MarkAcceptedConversationUserMessageInput = {
  runId: string;
  prompt: string;
};

export type AcceptConversationUserMessageInput = MarkAcceptedConversationUserMessageInput & {
  leaseOwner: ChatSessionLeaseOwner;
};

export type MarkAcceptedConversationUserMessageFailedInput = {
  runId: string;
  failureMessage: AppendConversationMessageInput;
};

export type EnqueueConversationPromptInput = {
  prompt: string;
  agentProfileId?: string;
  agentSnapshot?: CustomAgentExecutionSnapshot;
  systemContext?: string;
};

export type UpdateQueuedConversationPromptInput = {
  queueItemId: string;
  prompt: string;
};

export type DeleteQueuedConversationPromptInput = {
  queueItemId: string;
};

export type QueuedConversationPromptResult = {
  session: ChatSession;
  item: QueuedConversationPrompt;
  position: number;
};

export type DequeuedConversationPromptResult = {
  session: ChatSession;
  item?: QueuedConversationPrompt;
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
  agentProfileId?: string;
  agentSnapshot?: CustomAgentExecutionSnapshot;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  host?: ConversationEngineHost;
  abortSignal?: AbortSignal;
  shouldStop?: RunAgentLoopOptions['shouldStop'];
  leaseOwner?: ChatSessionLeaseOwner;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  approvalPolicies?: ToolApprovalPolicy[];
  traceSummarizerRegistry?: TraceSummaryService;
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
  traceSummarizerRegistry?: TraceSummaryService;
};

export type ClearConversationTurnLeaseInput = {
  sessionId: string;
  owner: ChatSessionLeaseOwner;
};

export type SubmitConversationTurnResult = ConversationTurnResultSummary;

export type ConversationEngineHost = {
  events?: {
    onActivity?: (activity: ConversationActivity) => void;
    onEvent?: (event: AgentLoopEvent) => void;
  };
  approvals?: {
    requestToolApproval?: ToolApprovalSurface;
  };
  compaction?: {
    onStatus?: (event: ConversationCompactionStatus) => void;
    onPreflightCompactionStatus?: (event: ConversationCompactionStatus) => void;
    onFinalCompactionStatus?: (event: ConversationCompactionStatus) => void;
  };
  trace?: {
    onEvent?: (event: TraceEvent) => void;
  };
};

export type NormalizedConversationEngineHost = {
  turnHost?: ChatTurnHostPort;
  onTraceEvent?: RunAgentLoopOptions['onTraceEvent'];
};
