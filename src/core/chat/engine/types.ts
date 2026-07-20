import type { ArtifactRepository, ArtifactService } from '@/core/artifacts/index.js';
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
import type { ChatArchiveRepository } from './sessions/archives/index.js';
import type {
  ChatSessionCatalogPage,
  ChatSessionRepository,
  ListChatSessionsInput,
} from './sessions/repository/index.js';
import type { ChatSession, ChatSessionRetention, QueuedConversationPrompt } from '../types.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { ChatTurnHostPort } from './turns/host/index.js';
import type { ConversationTurnResultSummary } from './turn-result.js';
import type { ConversationCompactionResult } from '@/core/chat/engine/compaction/index.js';
import type { RuntimeProviderCredential } from '@/core/runtime/credentials/index.js';
import type { RuntimeToolSelectionProfile } from '@/core/runtime/tools/index.js';
import type {
  HeddlePersistenceCapabilities,
  ResolvedHeddlePersistenceCapabilities,
} from './persistence/index.js';
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
  /**
   * Request-scoped provider credential. It stays in memory, is never refreshed
   * or persisted, and must not be combined with `apiKey`.
   */
  credential?: RuntimeProviderCredential;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  /** Default model-visible tool policy. A selected custom agent overrides it for that turn. */
  toolProfile?: RuntimeToolSelectionProfile;
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
  /**
   * Custom artifact persistence for hosted services that cannot use the
   * default file store under the state root. When set, the engine's artifact
   * reader, turn-result artifact listing, and artifact tools all persist
   * through this repository instead of `stateRoot/artifacts`.
   */
  artifactRepository?: ArtifactRepository;
  /**
   * Domain persistence capabilities configured as coherent units. New hosted
   * conversation integrations should provide both session and archive
   * repositories through `persistence.conversations`.
   */
  persistence?: HeddlePersistenceCapabilities;
  /**
   * Custom session persistence for hosted services. When set, session
   * create/read/update, turn preflight/persistence, leases, and background
   * memory-maintenance writes all flow through this repository instead of the
   * file catalog under the state root.
   *
   * @deprecated Use `persistence.conversations.sessions` together with the
   * paired archive repository.
   */
  sessionRepository?: ChatSessionRepository;
  /**
   * Durable storage for compacted raw transcripts, rolling summaries, and
   * archive manifests. Locators remain server-side and repository-owned.
   *
   * @deprecated Use `persistence.conversations.archives` together with the
   * paired session repository.
   */
  archiveRepository?: ChatArchiveRepository;
};

export type ConversationEngineHostExtensions = ConversationEngineHostExtensionBundle;
export type ConversationEngineHostExtensionsInput = ConversationEngineHostExtensionInput;
export type { ConversationEngineHostExtension };

export type ConversationEngine = {
  sessions: ConversationSessionService;
  turns: ConversationTurnService;
  /** Resolved domain persistence capabilities and readiness evidence. */
  persistence: ResolvedHeddlePersistenceCapabilities;
  /**
   * Read/inspect artifacts saved during turns (e.g. for a host `/artifacts`
   * review command) without reconstructing the on-disk artifact root. Backed by
   * the engine's resolved `artifactRoot`, so it honors a custom
   * `hostExtensions.artifacts.root`.
   */
  artifacts: ArtifactService;
};

export type ConversationSessionService = {
  // Reads
  list(): Promise<ChatSession[]>;
  listCatalog(input?: Partial<ListChatSessionsInput>): Promise<ChatSessionCatalogPage>;
  // Persisted reads that do not materialize the host-facing fallback.
  listExisting(): Promise<ChatSession[]>;
  readExisting(id: string): Promise<ChatSession | undefined>;
  read(id: string): Promise<ChatSession | undefined>;
  require(id: string): Promise<ChatSession>;
  latest(): Promise<ChatSession | undefined>;
  latestExisting(): Promise<ChatSession | undefined>;

  // Lifecycle
  create(input?: CreateConversationSessionInput): Promise<ChatSession>;
  ensure(input: EnsureConversationSessionInput): Promise<EnsureConversationSessionResult>;
  createOneOff(input?: CreateConversationSessionInput): Promise<ChatSession>;
  rename(id: string, name: string): Promise<ChatSession>;
  setPinned(id: string, pinned: boolean): Promise<ChatSession>;
  setArchived(id: string, archived: boolean): Promise<ChatSession>;
  autoRenameAfterFirstUserMessage(id: string, input: AutoRenameConversationSessionInput): Promise<AutoRenameConversationSessionResult>;
  delete(id: string): Promise<boolean>;

  // Generic mutation escape hatch. The updater may be reapplied after an
  // optimistic-concurrency conflict, so it must not perform external side effects.
  update(id: string, updater: (session: ChatSession) => ChatSession): Promise<ChatSession | undefined>;

  // Settings
  updateSettings(id: string, input: UpdateConversationSessionSettingsInput): Promise<ChatSession>;
  setDriftEnabled(id: string, enabled: boolean): Promise<ChatSession>;

  // Messages
  appendMessage(id: string, input: AppendConversationMessageInput): Promise<ChatSession>;
  appendMessages(id: string, inputs: AppendConversationMessageInput[]): Promise<ChatSession>;
  acceptUserMessage(id: string, input: AcceptConversationUserMessageInput): Promise<ChatSession>;
  markAcceptedUserMessage(id: string, input: MarkAcceptedConversationUserMessageInput): Promise<ChatSession>;
  markAcceptedUserMessageFailed(id: string, input: MarkAcceptedConversationUserMessageFailedInput): Promise<ChatSession>;
  enqueuePrompt(id: string, input: EnqueueConversationPromptInput): Promise<QueuedConversationPromptResult>;
  updateQueuedPrompt(id: string, input: UpdateQueuedConversationPromptInput): Promise<ChatSession>;
  deleteQueuedPrompt(id: string, input: DeleteQueuedConversationPromptInput): Promise<ChatSession>;
  dequeueQueuedPrompt(id: string): Promise<DequeuedConversationPromptResult>;

  // Conversation state
  resetConversation(id: string): Promise<ChatSession>;
  setLastContinuePrompt(id: string, prompt: string | undefined): Promise<ChatSession>;

  // Compaction state
  markCompactionRunning(id: string, input: MarkConversationCompactionRunningInput): Promise<ChatSession>;
  applyCompactionResult(id: string, input: ApplyConversationCompactionResultInput): Promise<ChatSession>;
  restoreCompactionState(id: string, input: RestoreConversationCompactionStateInput): Promise<ChatSession>;

  // Leases
  getLeaseConflict(id: string, owner: ChatSessionLeaseOwner): Promise<string | undefined>;
  acquireLease(id: string, owner: ChatSessionLeaseOwner): Promise<ChatSession>;
  refreshLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): Promise<ChatSession>;
  releaseLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): Promise<ChatSession>;
};

export type CreateConversationSessionInput = {
  id?: string;
  name?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  workspaceId?: string;
  retention?: ChatSessionRetention;
};

/**
 * Stable session identity to read or create without a read-then-create race.
 * Creation fields apply only when the session does not already exist.
 */
export type EnsureConversationSessionInput = Omit<CreateConversationSessionInput, 'id'> & {
  id: string;
};

export type EnsureConversationSessionResult = {
  session: ChatSession;
  created: boolean;
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
  clearLease(input: ClearConversationTurnLeaseInput): Promise<void>;
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
