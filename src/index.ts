// ---------------------------------------------------------------------------
// Heddle — Public API
// ---------------------------------------------------------------------------

// Core loop
export { runAgent } from './run-agent.js';
export type { RunAgentOptions } from './run-agent.js';
export { runAgentLoop } from './runtime/agent-loop.js';
export type { AgentLoopEvent, AgentLoopResult, RunAgentLoopOptions } from './runtime/agent-loop.js';
export { runAgentHeartbeat } from './runtime/heartbeat.js';
export type { AgentHeartbeatResult, HeartbeatDecision, RunAgentHeartbeatOptions } from './runtime/heartbeat.js';
export {
  createFileHeartbeatCheckpointStore,
  runStoredHeartbeat,
  suggestNextHeartbeatDelayMs,
} from './runtime/heartbeat-store.js';
export type {
  FileHeartbeatCheckpointStoreOptions,
  HeartbeatCheckpointStore,
  RunStoredHeartbeatOptions,
  StoredHeartbeatResult,
} from './runtime/heartbeat-store.js';
export {
  createAgentLoopCheckpoint,
  getHistoryFromAgentLoopCheckpoint,
  getHistoryFromAgentLoopState,
} from './runtime/events.js';
export type { AgentLoopCheckpoint, AgentLoopState, AgentLoopStatus } from './runtime/events.js';
export { resolveApiKeyForModel, resolveProviderApiKey } from './runtime/api-keys.js';
export type { ApiKeyRuntime } from './runtime/api-keys.js';
export { createDefaultAgentTools } from './runtime/default-tools.js';
export type { DefaultAgentToolsOptions } from './runtime/default-tools.js';
export { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from './config.js';

// Types
export type {
  RunInput,
  RunResult,
  ToolDefinition,
  ToolCall,
  ToolResult,
  TraceEvent,
  StopReason,
} from './types.js';

// LLM
export type {
  LlmAdapter,
  ChatMessage,
  LlmResponse,
  LlmProvider,
  LlmAdapterCapabilities,
  LlmAdapterInfo,
  LlmUsage,
} from './llm/types.js';
export { createLlmAdapter, inferProviderFromModel, resolveLlmProvider } from './llm/factory.js';
export type { CreateLlmAdapterOptions } from './llm/factory.js';
export { createOpenAiAdapter } from './llm/openai.js';
export type { OpenAiAdapterOptions } from './llm/openai.js';
export { createAnthropicAdapter } from './llm/anthropic.js';
export type { AnthropicAdapterOptions } from './llm/anthropic.js';
export {
  OPENAI_MODEL_GROUPS,
  COMMON_OPENAI_MODELS,
  COMMON_BUILT_IN_MODELS,
  formatOpenAiModelGroups,
  formatBuiltInModelGroups,
  estimateOpenAiContextWindow,
  estimateBuiltInContextWindow,
  filterBuiltInModels,
} from './llm/openai-models.js';
export type { BuiltInModelGroup } from './llm/openai-models.js';

// Tools
export { createToolRegistry } from './tools/registry.js';
export type { ToolRegistry } from './tools/registry.js';
export { executeTool } from './tools/execute-tool.js';
export { listFilesTool } from './tools/list-files.js';
export { readFileTool } from './tools/read-file.js';
export { editFileTool } from './tools/edit-file.js';
export { searchFilesTool, createSearchFilesTool, DEFAULT_SEARCH_EXCLUDED_DIRS } from './tools/search-files.js';
export type { SearchFilesOptions } from './tools/search-files.js';
export { webSearchTool, createWebSearchTool } from './tools/web-search.js';
export type { WebSearchToolOptions } from './tools/web-search.js';
export { viewImageTool, createViewImageTool } from './tools/view-image.js';
export type { ViewImageToolOptions } from './tools/view-image.js';
export {
  listMemoryNotesTool,
  readMemoryNoteTool,
  searchMemoryNotesTool,
  editMemoryNoteTool,
  createListMemoryNotesTool,
  createReadMemoryNoteTool,
  createSearchMemoryNotesTool,
  createEditMemoryNoteTool,
} from './tools/memory-notes.js';
export type { MemoryNotesToolOptions } from './tools/memory-notes.js';
export { reportStateTool } from './tools/report-state.js';
export { updatePlanTool } from './tools/update-plan.js';
export type { PlanItem, PlanItemStatus } from './tools/update-plan.js';
export { createRunShellInspectTool, createRunShellMutateTool } from './tools/run-shell.js';
export { createRunShellTool } from './tools/run-shell.js';
export type { RunShellOptions } from './tools/run-shell.js';

// Trace
export { createTraceRecorder } from './trace/recorder.js';
export type { TraceRecorder } from './trace/recorder.js';
export { formatTraceForConsole } from './trace/format.js';

// Prompts
export { buildSystemPrompt } from './prompts/system-prompt.js';

// Utils
export { createBudget } from './utils/budget.js';
export type { Budget } from './utils/budget.js';
export { HeddleError, ToolExecutionError, LlmError, BudgetExhaustedError } from './utils/errors.js';
export { createLogger, logger } from './utils/logger.js';
