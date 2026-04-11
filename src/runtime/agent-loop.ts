import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { DEFAULT_OPENAI_MODEL } from '../config.js';
import { inferProviderFromModel } from '../llm/providers.js';
import type { ChatMessage, LlmAdapter, LlmProvider } from '../llm/types.js';
import { runAgent } from '../run-agent.js';
import type { RunAgentOptions } from '../run-agent.js';
import type { RunResult, ToolCall, ToolDefinition, TraceEvent } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { resolveApiKeyForModel } from './api-keys.js';
import { createFinishedAgentLoopState, getHistoryFromAgentLoopCheckpoint, getHistoryFromAgentLoopState } from './events.js';
import type { AgentLoopCheckpoint, AgentLoopEvent, AgentLoopState } from './events.js';

export type { AgentLoopCheckpoint, AgentLoopEvent, AgentLoopState } from './events.js';

export type RunAgentLoopOptions = {
  goal: string;
  model?: string;
  apiKey?: string;
  maxSteps?: number;
  workspaceRoot?: string;
  stateDir?: string;
  memoryDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  history?: ChatMessage[];
  resumeFrom?: AgentLoopState | AgentLoopCheckpoint;
  llm?: LlmAdapter;
  tools?: ToolDefinition[];
  extraTools?: ToolDefinition[];
  includeDefaultTools?: boolean;
  includePlanTool?: boolean;
  logger?: Logger;
  onEvent?: (event: AgentLoopEvent) => void;
  onTraceEvent?: (event: TraceEvent) => void;
  onAssistantStream?: RunAgentOptions['onAssistantStream'];
  approveToolCall?: (call: ToolCall, tool: ToolDefinition) => Promise<{ approved: boolean; reason?: string }>;
  shouldStop?: () => boolean;
  abortSignal?: AbortSignal;
};

export type AgentLoopResult = RunResult & {
  model: string;
  provider: LlmProvider;
  workspaceRoot: string;
  state: AgentLoopState;
};

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const model = options.model ?? options.llm?.info?.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const provider = inferProviderFromModel(model);
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const apiKey = options.apiKey ?? resolveApiKeyForModel(model);
  const llm = options.llm ?? await createLoopLlmAdapter({ model, apiKey });
  const logger = options.logger ?? createLogger({ pretty: false, level: 'info', console: false });
  const tools = await resolveTools({
    ...options,
    model,
    apiKey,
    workspaceRoot,
  });
  const now = () => new Date().toISOString();
  const startedAt = now();

  options.onEvent?.({
    type: 'loop.started',
    goal: options.goal,
    model,
    provider,
    workspaceRoot,
    timestamp: startedAt,
  });

  const result = await runAgent({
    goal: options.goal,
    llm,
    tools,
    maxSteps: options.maxSteps,
    logger,
    history: resolveHistory(options),
    systemContext: options.systemContext,
    onAssistantStream: (update) => {
      options.onEvent?.({
        type: 'assistant.stream',
        ...update,
        timestamp: now(),
      });
      options.onAssistantStream?.(update);
    },
    onEvent: (event) => {
      options.onEvent?.({ type: 'trace', event, timestamp: now() });
      options.onTraceEvent?.(event);
    },
    approveToolCall: options.approveToolCall,
    shouldStop: options.shouldStop,
    abortSignal: options.abortSignal,
  });

  const finishedAt = now();
  const state = createFinishedAgentLoopState({
    goal: options.goal,
    model,
    provider,
    workspaceRoot,
    startedAt,
    finishedAt,
    result,
  });

  options.onEvent?.({
    type: 'loop.finished',
    outcome: result.outcome,
    summary: result.summary,
    usage: result.usage,
    state,
    timestamp: finishedAt,
  });

  return {
    ...result,
    model,
    provider,
    workspaceRoot,
    state,
  };
}

function resolveHistory(options: Pick<RunAgentLoopOptions, 'history' | 'resumeFrom'>): ChatMessage[] | undefined {
  if (options.history) {
    return options.history;
  }

  if (!options.resumeFrom) {
    return undefined;
  }

  if ('version' in options.resumeFrom) {
    return getHistoryFromAgentLoopCheckpoint(options.resumeFrom);
  }

  return getHistoryFromAgentLoopState(options.resumeFrom);
}

async function createLoopLlmAdapter(options: { model: string; apiKey?: string }): Promise<LlmAdapter> {
  const { createLlmAdapter } = await import('../llm/factory.js');
  return createLlmAdapter(options);
}

async function resolveTools(
  options: RunAgentLoopOptions & {
    model: string;
    apiKey?: string;
    workspaceRoot: string;
  },
): Promise<ToolDefinition[]> {
  const providedTools = options.tools ?? [];
  const extraTools = options.extraTools ?? [];
  if (options.includeDefaultTools === false) {
    return [...providedTools, ...extraTools];
  }

  const { createDefaultAgentTools } = await import('./default-tools.js');
  return [
    ...createDefaultAgentTools({
      model: options.model,
      apiKey: options.apiKey,
      workspaceRoot: options.workspaceRoot,
      stateDir: options.stateDir,
      memoryDir: options.memoryDir,
      searchIgnoreDirs: options.searchIgnoreDirs,
      includePlanTool: options.includePlanTool,
    }),
    ...providedTools,
    ...extraTools,
  ];
}
