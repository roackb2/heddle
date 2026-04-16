// ---------------------------------------------------------------------------
// Heddle — Public API
// ---------------------------------------------------------------------------

// Core loop
export { runAgent } from './run-agent.js';
export type { RunAgentOptions } from './run-agent.js';
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
  runDueHeartbeatTasks,
  runHeartbeatScheduler,
} from './core/runtime/heartbeat-scheduler.js';
export type {
  FileHeartbeatTaskStoreOptions,
  HeartbeatSchedulerEvent,
  HeartbeatTask,
  HeartbeatTaskRunRecord,
  HeartbeatTaskRunRecordEntry,
  HeartbeatTaskRunner,
  HeartbeatTaskStore,
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
export { resolveApiKeyForModel, resolveProviderApiKey } from './core/runtime/api-keys.js';
export type { ApiKeyRuntime } from './core/runtime/api-keys.js';
export { createDefaultAgentTools } from './core/runtime/default-tools.js';
export type { DefaultAgentToolsOptions } from './core/runtime/default-tools.js';
export { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from './core/config.js';

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
export { reportStateTool } from './core/tools/report-state.js';
export { updatePlanTool } from './core/tools/update-plan.js';
export type { PlanItem, PlanItemStatus } from './core/tools/update-plan.js';
export { createRunShellInspectTool, createRunShellMutateTool } from './core/tools/run-shell.js';
export { createRunShellTool } from './core/tools/run-shell.js';
export type { RunShellOptions } from './core/tools/run-shell.js';

// Trace
export { createTraceRecorder } from './core/trace/recorder.js';
export type { TraceRecorder } from './core/trace/recorder.js';
export { formatTraceForConsole } from './core/trace/format.js';

// Prompts
export { buildSystemPrompt } from './core/prompts/system-prompt.js';

// Utils
export { createBudget } from './core/utils/budget.js';
export type { Budget } from './core/utils/budget.js';
export { HeddleError, ToolExecutionError, LlmError, BudgetExhaustedError } from './core/utils/errors.js';
export { createLogger, logger } from './core/utils/logger.js';
