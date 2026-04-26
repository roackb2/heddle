import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { DEFAULT_OPENAI_MODEL } from '../config.js';
import { inferProviderFromModel } from '../llm/providers.js';
import type { ChatMessage, LlmAdapter, LlmProvider } from '../llm/types.js';
import { runAgent } from '../agent/run-agent.js';
import type { RunAgentOptions } from '../agent/run-agent.js';
import type { RunResult, ToolCall, ToolDefinition, TraceEvent } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { resolveApiKeyForModel } from './api-keys.js';
import { createFinishedAgentLoopState, generateRunId, getHistoryFromAgentLoopCheckpoint, getHistoryFromAgentLoopState } from './events.js';
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
  const runId = generateRunId();
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

  const resumeMetadata = getResumeMetadata(options.resumeFrom);

  options.onEvent?.({
    type: 'loop.started',
    runId,
    goal: options.goal,
    model,
    provider,
    workspaceRoot,
    resumedFromCheckpoint: resumeMetadata?.checkpointRunId,
    timestamp: startedAt,
  });

  if (resumeMetadata) {
    options.onEvent?.({
      type: 'loop.resumed',
      runId,
      fromCheckpoint: resumeMetadata.checkpointRunId,
      priorTraceEvents: resumeMetadata.priorTraceEvents,
      timestamp: now(),
    });
  }

  const result = await runAgent({
    goal: options.goal,
    llm,
    tools,
    workspaceRoot,
    maxSteps: options.maxSteps,
    logger,
    history: resolveHistory(options),
    systemContext: options.systemContext,
    onAssistantStream: (update) => {
      options.onEvent?.({
        type: 'assistant.stream',
        runId,
        ...update,
        timestamp: now(),
      });
      options.onAssistantStream?.(update);
    },
    onEvent: (event) => {
      options.onEvent?.({ type: 'trace', runId, event, timestamp: now() });
      options.onTraceEvent?.(event);
    },
    onToolCalling: (call, step, toolDef) => {
      options.onEvent?.({
        type: 'tool.calling',
        runId,
        step,
        tool: call.tool,
        toolCallId: call.id,
        input: call.input,
        requiresApproval: toolDef.requiresApproval ?? false,
        timestamp: now(),
      });
    },
    onToolCompleted: (call, result, step, durationMs) => {
      options.onEvent?.({
        type: 'tool.completed',
        runId,
        step,
        tool: call.tool,
        toolCallId: call.id,
        result: { ok: result.ok, output: result.output, error: result.error },
        durationMs,
        timestamp: now(),
      });
    },
    approveToolCall: options.approveToolCall,
    shouldStop: options.shouldStop,
    abortSignal: options.abortSignal,
  });

  const finishedAt = now();
  const state = createFinishedAgentLoopState({
    runId,
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
    runId,
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

function getResumeMetadata(
  resumeFrom: AgentLoopState | AgentLoopCheckpoint | undefined,
): { checkpointRunId: string; priorTraceEvents: number } | undefined {
  if (!resumeFrom) {
    return undefined;
  }

  if ('version' in resumeFrom) {
    return {
      checkpointRunId: resumeFrom.runId,
      priorTraceEvents: resumeFrom.state.trace.length,
    };
  }

  return {
    checkpointRunId: resumeFrom.runId,
    priorTraceEvents: resumeFrom.trace.length,
  };
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
