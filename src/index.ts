// ---------------------------------------------------------------------------
// Heddle — Public API
// ---------------------------------------------------------------------------

// Core loop
export { runAgent } from './run-agent.js';
export type { RunAgentOptions } from './run-agent.js';
export { DEFAULT_OPENAI_MODEL } from './config.js';

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
export type { LlmAdapter, ChatMessage, LlmResponse, LlmProvider, LlmAdapterCapabilities, LlmAdapterInfo } from './llm/types.js';
export { createLlmAdapter, inferProviderFromModel, resolveLlmProvider } from './llm/factory.js';
export type { CreateLlmAdapterOptions } from './llm/factory.js';
export { createOpenAiAdapter } from './llm/openai.js';
export type { OpenAiAdapterOptions } from './llm/openai.js';

// Tools
export { createToolRegistry } from './tools/registry.js';
export type { ToolRegistry } from './tools/registry.js';
export { executeTool } from './tools/execute-tool.js';
export { listFilesTool } from './tools/list-files.js';
export { readFileTool } from './tools/read-file.js';
export { editFileTool } from './tools/edit-file.js';
export { searchFilesTool, createSearchFilesTool, DEFAULT_SEARCH_EXCLUDED_DIRS } from './tools/search-files.js';
export type { SearchFilesOptions } from './tools/search-files.js';
export { reportStateTool } from './tools/report-state.js';
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
