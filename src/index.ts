// ---------------------------------------------------------------------------
// Heddle — Public API
// ---------------------------------------------------------------------------

// Core loop
export { AgentRunService } from './core/agent/index.js';
export type { RunAgentOptions } from './core/agent/index.js';
export { AgentLoopCheckpointService, AgentLoopRuntimeService } from './core/runtime/loop/index.js';
export type { AgentLoopCheckpoint, AgentLoopEvent, AgentLoopResult, AgentLoopState, AgentLoopStatus, RunAgentLoopOptions } from './core/runtime/loop/index.js';
export { HeartbeatWakeService } from './core/heartbeat/wake/index.js';
export type {
  AgentHeartbeatEvent,
  AgentHeartbeatResult,
  HeartbeatDecision,
  HeartbeatDecisionEvent,
  HeartbeatEscalationEvent,
  RunAgentHeartbeatOptions,
} from './core/heartbeat/wake/index.js';
export {
  FileHeartbeatCheckpointRepository,
  StoredHeartbeatService,
} from './core/heartbeat/checkpoint/index.js';
export type {
  FileHeartbeatCheckpointRepositoryOptions,
  HeartbeatCheckpointStore,
  RunStoredHeartbeatOptions,
  StoredHeartbeatResult,
} from './core/heartbeat/checkpoint/index.js';
export {
  FileHeartbeatTaskRepository,
} from './core/heartbeat/tasks/index.js';
export type {
  FileHeartbeatTaskRepositoryOptions,
  HeartbeatTask,
  HeartbeatTaskRunRecord,
  HeartbeatTaskRunRecordEntry,
  HeartbeatTaskStore,
} from './core/heartbeat/tasks/index.js';
export {
  HeartbeatSchedulerService,
} from './core/heartbeat/scheduler/index.js';
export type {
  HeartbeatSchedulerEvent,
  HeartbeatTaskRunner,
  RunDueHeartbeatTasksOptions,
  RunDueHeartbeatTasksResult,
  RunHeartbeatSchedulerOptions,
} from './core/heartbeat/scheduler/index.js';
export {
  HeartbeatViewsPresenter,
} from './core/heartbeat/views/index.js';
export type {
  HeartbeatRunView,
  HeartbeatTaskView,
} from './core/heartbeat/views/index.js';
export {
  HeartbeatLucidPresenter,
} from './core/heartbeat/views/index.js';
export type {
  LucidAgentMessage,
  LucidAgentProgressNotification,
  LucidAgentResponseNotification,
  LucidAgentStatus,
  LucidAgentStatusNotification,
  LucidAdapterOptions,
} from './core/heartbeat/views/index.js';
export {
  RuntimeCredentialService,
} from './core/runtime/credentials/index.js';
export type { ApiKeyRuntime, ProviderCredentialSource } from './core/runtime/credentials/index.js';
export { RuntimeToolService } from './core/runtime/tools/index.js';
export type { DefaultAgentToolsOptions } from './core/runtime/tools/index.js';
export {
  createAwarenessService,
  createCodingAwarenessProvider,
  formatCodingProjectDashboardSnapshot,
} from './core/awareness/index.js';
export type {
  AwarenessCollectInput,
  AwarenessDomain,
  AwarenessLimit,
  AwarenessProfile,
  AwarenessProvider,
  AwarenessSnapshot,
  AwarenessSource,
  CodingAwarenessSection,
  CodingAwarenessSnapshot,
  CodingProjectDashboardOutput,
  CodingWorkingEnvironment,
  CodingWorkspaceTree,
  CodingWorkspaceTreeEntry,
} from './core/awareness/index.js';
export { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from './core/config.js';
export {
  buildMemoryDomainSystemContext,
} from './core/memory/domain-prompt.js';
export {
  DEFAULT_MEMORY_CATEGORIES,
  DEFAULT_MEMORY_FOLDER_CATALOG_MAX_BYTES,
  DEFAULT_MEMORY_FOLDER_CATALOG_TARGET_BYTES,
  DEFAULT_MEMORY_ROOT_CATALOG_MAX_BYTES,
  DEFAULT_MEMORY_ROOT_CATALOG_TARGET_BYTES,
  MemoryCatalogService,
} from './core/memory/catalog.js';
export { MemoryMaintenanceRepository } from './core/memory/maintenance-repository.js';
export { MemoryMaintenanceService } from './core/memory/maintainer.js';
export { MemoryMaintenanceIntegrationService } from './core/memory/maintenance-integration.js';
export { MemoryNoteService } from './core/memory/note-service.js';
export { MemoryValidationService } from './core/memory/validation.js';
export { MemoryVisibilityService } from './core/memory/visibility.js';
export type {
  BootstrapMemoryWorkspaceResult,
  KnowledgeCandidate,
  KnowledgeCandidateStatusRecord,
  KnowledgeMaintenanceRunRecord,
  ListMemoryNotesInput,
  MemoryCatalogLoadResult,
  MemoryCatalogShapeValidation,
  MemoryCategory,
  MemoryStatusView,
  MemoryValidationIssue,
  MemoryValidationResult,
  ReadMemoryNoteInput,
  RunMaintenanceForRecordedCandidatesOptions,
  RunMaintenanceForRecordedCandidatesResult,
  RunKnowledgeMaintenanceOptions,
  RunKnowledgeMaintenanceResult,
  SearchMemoryNotesInput,
} from './core/memory/types.js';
export { createMemoryMaintainerTools } from './core/memory/maintainer-tools.js';
export { createMemoryNoteTemplate, slugifyMemoryTitle } from './core/memory/templates.js';

// Integrations
export {
  createCyberLoopObserver,
  createRuntimeFrameEmbedder,
  eventToRuntimeFrame,
  formatRuntimeFrameForEmbedding,
  inferDriftLevel,
} from './integrations/cyberloop.js';
export { createCyberLoopKinematicsObserver } from './integrations/cyberloop-kinematics.js';
export type {
  CyberLoopCompatibleMiddleware,
  CyberLoopCompatibleStateEmbedder,
  CyberLoopDriftLevel,
  CyberLoopMetadataChannels,
  CyberLoopObserver,
  CyberLoopObserverAnnotation,
  CyberLoopStepContext,
  CyberLoopStepResult,
  CreateRuntimeFrameEmbedderOptions,
  HeddleRuntimeFrame,
  HeddleRuntimeFrameKind,
  RuntimeFrameEmbedText,
} from './integrations/cyberloop.js';
export type {
  CreateCyberLoopKinematicsObserverOptions,
  CyberLoopKinematicsObserver,
} from './integrations/cyberloop-kinematics.js';

// Types
export type {
  RunInput,
  RunResult,
  ToolDefinition,
  ToolCall,
  ToolResult,
  TraceEvent,
  StopReason,
} from './core/types.js';

// LLM
export type {
  LlmAdapter,
  LlmAdapterCreateInput,
  ChatMessage,
  LlmResponse,
  LlmProvider,
  ReasoningEffort,
  LlmAdapterCapabilities,
  LlmAdapterInfo,
  LlmUsage,
} from './core/llm/types.js';
export {
  AnthropicAdapter,
  AnthropicProviderAdapter,
  LlmAdapterService,
  LlmProviderRegistry,
  OpenAiAdapter,
  OpenAiCodexSseService,
  OpenAiOAuthFetchService,
  OpenAiProviderAdapter,
} from './core/llm/index.js';
export type {
  AnthropicAdapterOptions,
  LlmProviderAdapter,
  OpenAiAdapterOptions,
  OpenAiOAuthFetchOptions,
} from './core/llm/index.js';
export {
  OPENAI_MODEL_GROUPS,
  COMMON_OPENAI_MODELS,
  COMMON_BUILT_IN_MODELS,
  ModelCatalogService,
  ModelPolicyService,
} from './core/llm/models/index.js';
export type { BuiltInModelGroup } from './core/llm/models/index.js';

// Tools
export { createToolRegistry } from './core/tools/registry.js';
export type { ToolRegistry } from './core/tools/registry.js';
export { executeTool } from './core/tools/execute-tool.js';
export { listFilesTool } from './core/tools/toolkits/coding-files/list-files.js';
export { readFileTool } from './core/tools/toolkits/coding-files/read-file.js';
export { editFileTool } from './core/tools/toolkits/coding-files/edit-file.js';
export { deleteFileTool, createDeleteFileTool } from './core/tools/toolkits/coding-files/delete-file.js';
export type { DeleteFileToolOptions } from './core/tools/toolkits/coding-files/delete-file.js';
export { moveFileTool, createMoveFileTool } from './core/tools/toolkits/coding-files/move-file.js';
export type { MoveFileToolOptions } from './core/tools/toolkits/coding-files/move-file.js';
export { searchFilesTool, createSearchFilesTool, DEFAULT_SEARCH_EXCLUDED_DIRS } from './core/tools/toolkits/coding-files/search-files.js';
export type { SearchFilesOptions } from './core/tools/toolkits/coding-files/search-files.js';
export { webSearchTool, createWebSearchTool } from './core/tools/toolkits/external-context/web-search.js';
export type { WebSearchToolOptions } from './core/tools/toolkits/external-context/web-search.js';
export { viewImageTool, createViewImageTool } from './core/tools/toolkits/external-context/view-image.js';
export type { ViewImageToolOptions } from './core/tools/toolkits/external-context/view-image.js';
export {
  listMemoryNotesTool,
  readMemoryNoteTool,
  searchMemoryNotesTool,
  editMemoryNoteTool,
  createListMemoryNotesTool,
  createReadMemoryNoteTool,
  createSearchMemoryNotesTool,
  createEditMemoryNoteTool,
} from './core/tools/toolkits/knowledge/memory-notes.js';
export type { MemoryNotesToolOptions } from './core/tools/toolkits/knowledge/memory-notes.js';
export { createMemoryCheckpointTool } from './core/tools/toolkits/knowledge/memory-checkpoint.js';
export type { MemoryCheckpointToolOptions } from './core/tools/toolkits/knowledge/memory-checkpoint.js';
export { createRecordKnowledgeTool, recordKnowledgeTool } from './core/tools/toolkits/knowledge/record-knowledge.js';
export type { RecordKnowledgeToolOptions } from './core/tools/toolkits/knowledge/record-knowledge.js';
export { updatePlanTool } from './core/tools/toolkits/internal/update-plan.js';
export type { PlanItem, PlanItemStatus } from './core/tools/toolkits/internal/update-plan.js';
export { createRunShellInspectTool, createRunShellMutateTool } from './core/tools/toolkits/shell-process/run-shell.js';
export { createRunShellTool } from './core/tools/toolkits/shell-process/run-shell.js';
export type { RunShellOptions } from './core/tools/toolkits/shell-process/run-shell.js';

// Approvals
export {
  PendingToolApprovalRequests,
  ToolApprovalPolicies,
  ToolApprovalService,
} from './core/approvals/index.js';
export {
  FileProjectApprovalRuleRepository,
  ProjectApprovalRuleCodec,
  ProjectApprovalRules,
} from './core/approvals/remembered-rules/index.js';
export type {
  EvaluateToolApprovalPoliciesArgs,
  PendingToolApprovalView,
  RequestPendingToolApprovalArgs,
  ResolveToolApprovalArgs,
  ToolApprovalDecision,
  ToolApprovalPolicy,
  ToolApprovalPolicyContext,
  ToolApprovalPolicyDecision,
  ToolApprovalSurface,
} from './core/approvals/types.js';
export type {
  ApprovalMode,
  ApprovalRuleTool,
  ProjectApprovalRule,
} from './core/approvals/remembered-rules/index.js';

// Trace
export { TraceConsoleFormatter, TraceRecorder } from './core/trace/index.js';
export type { TraceRecordSink } from './core/trace/index.js';
export { ReviewDiffParser } from './core/review/index.js';
export type {
  ReviewDiffFile,
  ReviewDiffHunk,
  ReviewDiffLine,
  ReviewFileStatus,
} from './core/review/index.js';
export {
  DEFAULT_TRACE_SUMMARIZERS,
  ConversationActivityProjector,
  ToolActivitySummarizer,
  TraceSummaryService,
} from './core/observability/index.js';
export type {
  ApplyConversationActivityHandlerArgs,
  ConversationActivity,
  ConversationActivityCorrelation,
  ConversationActivityDerived,
  ConversationActivityHandlerMap,
  ConversationActivityOf,
  ConversationCompactionStatus,
  TraceEventOfType,
  TraceEventType,
  TraceSummarizer,
  TraceSummarizerMap,
  TraceSummaryContext,
  TraceSummaryValue,
  ToolCallSummaryInput,
  ToolResultSummaryOptions,
  ToolSummaryOptions,
} from './core/observability/index.js';
export {
  TRACE_CORRELATION_FIELDS,
  TRACE_EVENT_DOMAINS,
  TRACE_EVENT_TYPES,
} from './core/observability/index.js';

// Chat alpha API
export { createConversationEngine } from './core/chat/engine/conversation-engine.js';
export type {
  ClearConversationTurnLeaseInput,
  ConversationEngine,
  ConversationEngineConfig,
  ConversationEngineHost,
  ConversationSessionService,
  ConversationTurnService,
  CreateConversationSessionInput,
  ContinueConversationTurnInput,
  SubmitConversationTurnInput,
  SubmitConversationTurnResult,
  UpdateConversationSessionSettingsInput,
} from './core/chat/engine/types.js';
export { EngineConversationTurnService } from './core/chat/engine/turns/service.js';
export type {
  RunConversationTurnArgs,
  RunConversationTurnResult,
} from './core/chat/engine/turns/types.js';

// Prompts
export { buildSystemPrompt } from './core/prompts/system-prompt.js';

// Utils
export { createBudget } from './core/utils/budget.js';
export type { Budget } from './core/utils/budget.js';
export { HeddleError, ToolExecutionError, LlmError, BudgetExhaustedError } from './core/utils/errors.js';
export { createLogger, logger } from './core/utils/logger.js';
