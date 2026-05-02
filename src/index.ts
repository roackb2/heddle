// ---------------------------------------------------------------------------
// Heddle — Public API
// ---------------------------------------------------------------------------

// Core loop
export { runAgent } from './core/agent/run-agent.js';
export type { RunAgentOptions } from './core/agent/run-agent.js';
export { runAgentLoop } from './core/runtime/agent-loop.js';
export type { AgentLoopEvent, AgentLoopResult, RunAgentLoopOptions } from './core/runtime/agent-loop.js';
export { runAgentHeartbeat } from './core/runtime/heartbeat.js';
export type { AgentHeartbeatResult, HeartbeatDecision, RunAgentHeartbeatOptions } from './core/runtime/heartbeat.js';
export {
  createFileHeartbeatCheckpointStore,
  runStoredHeartbeat,
  suggestNextHeartbeatDelayMs,
} from './core/runtime/heartbeat-store.js';
export type {
  FileHeartbeatCheckpointStoreOptions,
  HeartbeatCheckpointStore,
  RunStoredHeartbeatOptions,
  StoredHeartbeatResult,
} from './core/runtime/heartbeat-store.js';
export {
  createFileHeartbeatTaskStore,
} from './core/runtime/heartbeat-task-store.js';
export type {
  FileHeartbeatTaskStoreOptions,
  HeartbeatTask,
  HeartbeatTaskRunRecord,
  HeartbeatTaskRunRecordEntry,
  HeartbeatTaskStore,
} from './core/runtime/heartbeat-task-store.js';
export {
  runDueHeartbeatTasks,
  runHeartbeatScheduler,
} from './core/runtime/heartbeat-scheduler.js';
export type {
  HeartbeatSchedulerEvent,
  HeartbeatTaskRunner,
  RunDueHeartbeatTasksOptions,
  RunDueHeartbeatTasksResult,
  RunHeartbeatSchedulerOptions,
} from './core/runtime/heartbeat-scheduler.js';
export {
  listHeartbeatRunViews,
  listHeartbeatTaskViews,
  loadHeartbeatRunView,
  projectHeartbeatRunView,
  projectHeartbeatTaskView,
} from './core/runtime/heartbeat-views.js';
export type {
  HeartbeatRunView,
  HeartbeatTaskView,
} from './core/runtime/heartbeat-views.js';
export {
  heartbeatSchedulerEventToLucidMessages,
  heartbeatRunViewToLucidMessages,
  heartbeatTaskStatusToLucidStatus,
  heartbeatTaskViewToLucidMessages,
} from './core/runtime/heartbeat-lucid.js';
export type {
  LucidAgentMessage,
  LucidAgentProgressNotification,
  LucidAgentResponseNotification,
  LucidAgentStatus,
  LucidAgentStatusNotification,
  LucidAdapterOptions,
} from './core/runtime/heartbeat-lucid.js';
export {
  createAgentLoopCheckpoint,
  getHistoryFromAgentLoopCheckpoint,
  getHistoryFromAgentLoopState,
} from './core/runtime/events.js';
export type { AgentLoopCheckpoint, AgentLoopState, AgentLoopStatus } from './core/runtime/events.js';
export {
  formatMissingProviderCredentialMessage,
  hasProviderCredentialForModel,
  resolveApiKeyForModel,
  resolveOAuthCredentialForModel,
  resolveProviderApiKey,
  resolveProviderCredentialSourceForModel,
} from './core/runtime/api-keys.js';
export type { ApiKeyRuntime, ProviderCredentialSource } from './core/runtime/api-keys.js';
export { createDefaultAgentTools } from './core/runtime/default-tools.js';
export type { DefaultAgentToolsOptions } from './core/runtime/default-tools.js';
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
  appendMemoryCatalogSystemContext,
  bootstrapMemoryWorkspace,
  formatMemoryCatalogSystemContext,
  loadMemoryRootCatalog,
  validateMemoryCatalogShape,
} from './core/memory/catalog.js';
export type {
  BootstrapMemoryWorkspaceResult,
  MemoryCatalogLoadResult,
  MemoryCatalogShapeValidation,
  MemoryCategory,
} from './core/memory/catalog.js';
export {
  readPendingKnowledgeCandidates,
  runKnowledgeMaintenance,
  runKnowledgeMaintenanceForBacklog,
} from './core/memory/maintainer.js';
export type {
  KnowledgeCandidate,
  KnowledgeMaintenanceRunRecord,
  RunKnowledgeMaintenanceOptions,
  RunKnowledgeMaintenanceResult,
} from './core/memory/maintainer.js';
export { createMemoryMaintainerTools } from './core/memory/maintainer-tools.js';
export { createMemoryNoteTemplate, slugifyMemoryTitle } from './core/memory/templates.js';
export { runMaintenanceForRecordedCandidates } from './core/memory/maintenance-integration.js';
export type {
  RunMaintenanceForRecordedCandidatesOptions,
  RunMaintenanceForRecordedCandidatesResult,
} from './core/memory/maintenance-integration.js';

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
  ChatMessage,
  LlmResponse,
  LlmProvider,
  LlmAdapterCapabilities,
  LlmAdapterInfo,
  LlmUsage,
} from './core/llm/types.js';
export { createLlmAdapter, inferProviderFromModel, resolveLlmProvider } from './core/llm/factory.js';
export type { CreateLlmAdapterOptions } from './core/llm/factory.js';
export { createOpenAiAdapter } from './core/llm/openai.js';
export type { OpenAiAdapterOptions } from './core/llm/openai.js';
export { createAnthropicAdapter } from './core/llm/anthropic.js';
export type { AnthropicAdapterOptions } from './core/llm/anthropic.js';
export {
  OPENAI_MODEL_GROUPS,
  COMMON_OPENAI_MODELS,
  COMMON_BUILT_IN_MODELS,
  formatOpenAiModelGroups,
  formatBuiltInModelGroups,
  estimateOpenAiContextWindow,
  estimateBuiltInContextWindow,
  filterBuiltInModels,
} from './core/llm/openai-models.js';
export type { BuiltInModelGroup } from './core/llm/openai-models.js';

// Tools
export { createToolRegistry } from './core/tools/registry.js';
export type { ToolRegistry } from './core/tools/registry.js';
export { executeTool } from './core/tools/execute-tool.js';
export { listFilesTool } from './core/tools/list-files.js';
export { readFileTool } from './core/tools/read-file.js';
export { editFileTool } from './core/tools/edit-file.js';
export { deleteFileTool, createDeleteFileTool } from './core/tools/delete-file.js';
export type { DeleteFileToolOptions } from './core/tools/delete-file.js';
export { moveFileTool, createMoveFileTool } from './core/tools/move-file.js';
export type { MoveFileToolOptions } from './core/tools/move-file.js';
export { searchFilesTool, createSearchFilesTool, DEFAULT_SEARCH_EXCLUDED_DIRS } from './core/tools/search-files.js';
export type { SearchFilesOptions } from './core/tools/search-files.js';
export { webSearchTool, createWebSearchTool } from './core/tools/web-search.js';
export type { WebSearchToolOptions } from './core/tools/web-search.js';
export { viewImageTool, createViewImageTool } from './core/tools/view-image.js';
export type { ViewImageToolOptions } from './core/tools/view-image.js';
export {
  listMemoryNotesTool,
  readMemoryNoteTool,
  searchMemoryNotesTool,
  editMemoryNoteTool,
  createListMemoryNotesTool,
  createReadMemoryNoteTool,
  createSearchMemoryNotesTool,
  createEditMemoryNoteTool,
} from './core/tools/memory-notes.js';
export type { MemoryNotesToolOptions } from './core/tools/memory-notes.js';
export { createMemoryCheckpointTool } from './core/tools/memory-checkpoint.js';
export type { MemoryCheckpointToolOptions } from './core/tools/memory-checkpoint.js';
export { createRecordKnowledgeTool, recordKnowledgeTool } from './core/tools/record-knowledge.js';
export type { RecordKnowledgeToolOptions } from './core/tools/record-knowledge.js';
export { updatePlanTool } from './core/tools/update-plan.js';
export type { PlanItem, PlanItemStatus } from './core/tools/update-plan.js';
export { createRunShellInspectTool, createRunShellMutateTool } from './core/tools/run-shell.js';
export { createRunShellTool } from './core/tools/run-shell.js';
export type { RunShellOptions } from './core/tools/run-shell.js';

// Approvals
export {
  defaultToolApprovalPolicies,
  isOutsideWorkspaceInspectionCall,
  outsideWorkspaceInspectionPolicy,
  rememberedApprovalPolicy,
  toolRequiresApprovalPolicy,
} from './core/approvals/default-policies.js';
export { evaluateToolApprovalPolicies, resolveToolApproval } from './core/approvals/policy-chain.js';
export { humanApprovalPolicy, requestToolApproval } from './core/approvals/surface.js';
export type {
  ToolApprovalDecision,
  ToolApprovalPolicy,
  ToolApprovalPolicyContext,
  ToolApprovalPolicyDecision,
  ToolApprovalSurface,
} from './core/approvals/types.js';

// Trace
export { createTraceRecorder } from './core/trace/recorder.js';
export type { TraceRecorder } from './core/trace/recorder.js';
export { formatTraceForConsole } from './core/trace/format.js';
export {
  DEFAULT_TRACE_SUMMARIZERS,
  countAssistantSteps,
  createTraceSummarizerRegistry,
  summarizeTrace,
} from './core/observability/trace-summarizers.js';
export type {
  TraceEventOfType,
  TraceEventType,
  TraceSummarizer,
  TraceSummarizerMap,
  TraceSummarizerRegistry,
  TraceSummaryContext,
} from './core/observability/trace-summarizers.js';
export {
  TRACE_CORRELATION_FIELDS,
  TRACE_EVENT_DOMAINS,
  TRACE_EVENT_TYPES,
} from './core/observability/semantic-conventions.js';
export {
  projectAgentLoopEventToConversationActivities,
  projectCompactionStatusToConversationActivities,
  projectTraceEventToConversationActivities,
  applyConversationActivityHandler,
  summarizeToolCall,
  summarizeToolResult,
} from './core/observability/conversation-activity.js';
export type {
  ConversationActivity,
  ConversationActivityCorrelation,
  ConversationActivityHandlerMap,
  ConversationActivityOf,
  ConversationCompactionStatus,
} from './core/observability/conversation-activity.js';

// Prompts
export { buildSystemPrompt } from './core/prompts/system-prompt.js';

// Utils
export { createBudget } from './core/utils/budget.js';
export type { Budget } from './core/utils/budget.js';
export { HeddleError, ToolExecutionError, LlmError, BudgetExhaustedError } from './core/utils/errors.js';
export { createLogger, logger } from './core/utils/logger.js';
