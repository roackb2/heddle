// ---------------------------------------------------------------------------
// runAgent — the heart of Heddle
// A minimal, executable agent loop.
// ---------------------------------------------------------------------------

import type { RunResult, ToolDefinition, StopReason, ToolCall, ToolResult, TraceEvent } from './types.js';
import type { LlmAdapter, LlmResponse, LlmUsage, ChatMessage } from './llm/types.js';
import { createToolRegistry } from './tools/registry.js';
import type { ToolRegistry } from './tools/registry.js';
import { createTraceRecorder } from './trace/recorder.js';
import { createBudget } from './utils/budget.js';
import { buildSystemPrompt } from './prompts/system-prompt.js';
import { logger as defaultLogger } from './utils/logger.js';
import type { Logger } from 'pino';

import { sanitizeHistory } from './run-agent/history.js';
import { isAbortError, isRecoverableToolError } from './run-agent/util.js';
import { createMutationState, trackToolResult } from './run-agent/mutation-tracking.js';
import { createProgressReminderState, buildProgressReminders } from './run-agent/progress-reminders.js';
import {
  buildPostMutationRequirement,
  hasStructuredChangeSummary,
  buildStructuredChangeSummaryRequirement,
} from './run-agent/post-mutation.js';
import { maybeDenyToolCall, executeToolCallWithFallback } from './run-agent/tool-dispatch.js';
import type { PlanItem } from './tools/update-plan.js';

const PLAN_ITEM_STATUSES = new Set<PlanItem['status']>(['pending', 'in_progress', 'completed']);

const DEFAULT_MAX_STEPS = 20;
const MAX_CONSECUTIVE_ERRORS = 3;
const INTERRUPTED_SUMMARY = 'Run interrupted by host request';

export type RunAgentOptions = {
  goal: string;
  llm: LlmAdapter;
  tools: ToolDefinition[];
  maxSteps?: number;
  logger?: Logger;
  history?: ChatMessage[];
  systemContext?: string;
  onEvent?: (event: TraceEvent) => void;
  approveToolCall?: (call: ToolCall, tool: ToolDefinition) => Promise<{ approved: boolean; reason?: string }>;
  shouldStop?: () => boolean;
  abortSignal?: AbortSignal;
};

type RunState = {
  step: number;
  consecutiveErrors: number;
  outcome: StopReason;
  summary: string;
  usage?: LlmUsage;
  activePlan?: {
    explanation?: string;
    items: PlanItem[];
  };
};

type RunContext = {
  goal: string;
  maxSteps: number;
  llm: LlmAdapter;
  registry: ToolRegistry;
  log: Logger;
  messages: ChatMessage[];
  trace: ReturnType<typeof createTraceRecorder>;
  record: (event: TraceEvent) => void;
  now: () => string;
  budget: ReturnType<typeof createBudget>;
  seenToolCalls: Map<string, number>;
  mutation: ReturnType<typeof createMutationState>;
  progress: ReturnType<typeof createProgressReminderState>;
  approveToolCall?: RunAgentOptions['approveToolCall'];
  shouldStop?: RunAgentOptions['shouldStop'];
  abortSignal?: AbortSignal;
  state: RunState;
};

/**
 * Run the agent loop.
 *
 * 1. Build messages (system prompt + transcript so far)
 * 2. Call LLM
 * 3. If model returns content only → record message, check if done
 * 4. If model returns tool calls → execute each, record results
 * 5. Check budget → stop if exhausted
 * 6. Repeat
 */
export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const context = createRunContext(options);

  context.log.info({ goal: options.goal, maxSteps: context.maxSteps, tools: context.registry.names() }, 'Agent run started');
  context.record({ type: 'run.started', goal: options.goal, timestamp: context.now() });

  while (!context.budget.exhausted()) {
    const interrupted = maybeFinishInterrupted(context, 'Agent run interrupted before next step');
    if (interrupted) {
      return interrupted;
    }

    beginStep(context);
    const responseResult = await requestModelTurn(context);
    if (isRunResult(responseResult)) {
      return responseResult;
    }

    if (responseResult.toolCalls && responseResult.toolCalls.length > 0) {
      const toolTurnResult = await handleToolTurn(context, responseResult);
      if (toolTurnResult !== 'continue') {
        return toolTurnResult;
      }
      continue;
    }

    const finalResponse = finalizeAssistantResponse(context, responseResult);
    if (finalResponse === 'continue') {
      continue;
    }

    return finalResponse;
  }

  return finishRun(context, 'max_steps', `Reached maximum step limit (${context.maxSteps})`, {
    logLevel: 'warn',
    logMessage: 'Budget exhausted',
  });
}

function createRunContext(options: RunAgentOptions): RunContext {
  const registry = createToolRegistry(options.tools);
  const trace = createTraceRecorder();
  const now = () => new Date().toISOString();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  return {
    goal: options.goal,
    maxSteps,
    llm: options.llm,
    registry,
    log: options.logger ?? defaultLogger,
    messages: buildInitialMessages(options.goal, registry.names(), options.systemContext, options.history),
    trace,
    record: (event) => {
      trace.record(event);
      options.onEvent?.(event);
    },
    now,
    budget: createBudget(maxSteps),
    seenToolCalls: new Map<string, number>(),
    mutation: createMutationState(),
    progress: createProgressReminderState(),
    approveToolCall: options.approveToolCall,
    shouldStop: options.shouldStop,
    abortSignal: options.abortSignal,
    state: {
      step: 0,
      consecutiveErrors: 0,
      outcome: 'max_steps',
      summary: '',
    },
  };
}

function buildInitialMessages(
  goal: string,
  toolNames: string[],
  systemContext: string | undefined,
  history: ChatMessage[] | undefined,
): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(goal, toolNames, systemContext) },
    ...sanitizeHistory(history ?? []),
    { role: 'user', content: goal },
  ];
}

function beginStep(context: RunContext) {
  context.state.step++;
  context.budget.step();
  context.log.debug({ step: context.state.step, budgetRemaining: context.budget.remaining() }, 'Calling LLM');
}

async function requestModelTurn(context: RunContext): Promise<LlmResponse | RunResult> {
  if (context.abortSignal?.aborted) {
    return finishInterrupted(context, 'Agent run interrupted before LLM call');
  }

  try {
    const response = await context.llm.chat(context.messages, context.registry.list(), context.abortSignal);
    context.state.usage = accumulateUsage(context.state.usage, response.usage);
    return response;
  } catch (error) {
    if (isAbortError(error) || context.abortSignal?.aborted || context.shouldStop?.()) {
      return finishInterrupted(context, 'Agent run interrupted during LLM call');
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    context.log.error({ step: context.state.step, error: errorMessage }, 'LLM call failed');
    return finishRun(context, 'error', `LLM error: ${errorMessage}`);
  }
}

async function handleToolTurn(context: RunContext, response: LlmResponse): Promise<RunResult | 'continue'> {
  const toolCalls = response.toolCalls ?? [];
  context.record({
    type: 'assistant.turn',
    content: response.content ?? '',
    diagnostics: response.diagnostics,
    requestedTools: true,
    toolCalls,
    step: context.state.step,
    timestamp: context.now(),
  });

  context.messages.push({
    role: 'assistant',
    content: response.content ?? '',
    toolCalls,
  });

  for (const call of toolCalls) {
    const toolCallResult = await executeToolTurn(context, call);
    if (toolCallResult) {
      return toolCallResult;
    }
  }

  return 'continue';
}

async function executeToolTurn(context: RunContext, call: ToolCall): Promise<RunResult | undefined> {
  const interrupted = maybeFinishInterrupted(context, 'Agent run interrupted before tool execution');
  if (interrupted) {
    return interrupted;
  }

  const tool = context.registry.get(call.tool);
  const approvalDeniedResult = await maybeDenyToolCall({
    call,
    tool,
    step: context.state.step,
    now: context.now,
    approveToolCall: context.approveToolCall,
    record: context.record,
    log: context.log,
  });
  if (approvalDeniedResult) {
    return handleDeniedToolResult(context, call.id, approvalDeniedResult);
  }

  const execution = await executeToolCallWithFallback({
    call,
    step: context.state.step,
    now: context.now,
    registry: context.registry,
    seenToolCalls: context.seenToolCalls,
    approveToolCall: context.approveToolCall,
    record: context.record,
    log: context.log,
  });

  return handleExecutedToolResult(context, execution.effectiveCall, call.id, execution.result);
}

function handleDeniedToolResult(
  context: RunContext,
  toolCallId: string,
  result: ToolResult,
): RunResult | undefined {
  context.state.consecutiveErrors++;
  const maybeFailure = maybeFinishAfterConsecutiveErrors(
    context,
    `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors. Last error: ${result.error}`,
  );
  if (maybeFailure) {
    return maybeFailure;
  }

  context.messages.push({
    role: 'tool',
    content: JSON.stringify(result),
    toolCallId,
  });
  return undefined;
}

function handleExecutedToolResult(
  context: RunContext,
  effectiveCall: ToolCall,
  toolCallId: string,
  result: ToolResult,
): RunResult | undefined {
  if (!result.ok) {
    const maybeFailure = handleFailedToolExecution(context, result);
    if (maybeFailure) {
      return maybeFailure;
    }
  } else {
    context.state.consecutiveErrors = 0;
    trackToolResult(context.mutation, effectiveCall, result);
    if (effectiveCall.tool === 'update_plan') {
      context.state.activePlan = parsePlanState(result.output);
    }
  }

  context.messages.push({
    role: 'tool',
    content: JSON.stringify(result),
    toolCallId,
  });
  pushProgressReminders(context, effectiveCall, result);
  return undefined;
}

function handleFailedToolExecution(context: RunContext, result: ToolResult): RunResult | undefined {
  if (isRecoverableToolError(result.error)) {
    context.messages.push({
      role: 'system',
      content:
        `Host reminder: the last tool call failed due to invalid or repeated tool use: ${result.error}. Correct the call immediately, switch tools, or use report_state if you are blocked. Do not keep retrying the same failing pattern.`,
    });
  } else {
    context.state.consecutiveErrors++;
  }

  return maybeFinishAfterConsecutiveErrors(
    context,
    `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors. Last error: ${result.error}`,
  );
}

function pushProgressReminders(context: RunContext, effectiveCall: ToolCall, result: ToolResult) {
  const reminders = buildProgressReminders(context.progress, {
    effectiveCall,
    result,
    remainingSteps: context.budget.remaining(),
  });

  for (const reminder of reminders) {
    context.messages.push({ role: 'system', content: reminder });
  }
}

function finalizeAssistantResponse(context: RunContext, response: LlmResponse): RunResult | 'continue' {
  if (!response.content) {
    return finishRun(context, 'error', 'Model returned an empty response');
  }

  const planBlocker = getPlanCompletionBlocker(context);
  if (planBlocker) {
    context.messages.push({ role: 'system', content: planBlocker });
    return 'continue';
  }

  const completionBlocker = getCompletionBlocker(context, response.content);
  if (completionBlocker) {
    context.messages.push({ role: 'system', content: completionBlocker });
    return 'continue';
  }

  context.record({
    type: 'assistant.turn',
    content: response.content,
    diagnostics: response.diagnostics,
    requestedTools: false,
    step: context.state.step,
    timestamp: context.now(),
  });
  context.messages.push({ role: 'assistant', content: response.content });

  return finishRun(context, 'done', response.content, {
    logLevel: 'info',
    logMessage: 'Agent run finished',
  });
}

function getPlanCompletionBlocker(context: RunContext): string | undefined {
  const activePlan = context.state.activePlan;
  if (!activePlan) {
    return undefined;
  }

  const remainingItems = activePlan.items.filter((item) => item.status !== 'completed');
  if (remainingItems.length === 0) {
    return undefined;
  }

  const remainingSummary = remainingItems.map((item) => `${item.status}: ${item.step}`).join('; ');
  context.log.info(
    {
      step: context.state.step,
      remainingPlanItems: remainingItems.length,
    },
    'Blocking final answer until recorded plan is completed or updated',
  );
  return `Host reminder: you recorded a plan and it still has unfinished items (${remainingSummary}). Continue the planned work, or update the plan to mark items completed or no longer needed before giving the final answer.`;
}

function getCompletionBlocker(context: RunContext, responseContent: string): string | undefined {
  if (context.mutation.pendingVerification || context.mutation.pendingChangeReview) {
    context.log.info(
      {
        step: context.state.step,
        pendingVerification: context.mutation.pendingVerification,
        pendingChangeReview: context.mutation.pendingChangeReview,
      },
      'Blocking premature final answer until mutation follow-up is complete',
    );
    return buildPostMutationRequirement({
      pendingVerification: context.mutation.pendingVerification,
      pendingChangeReview: context.mutation.pendingChangeReview,
      reviewCommands: context.mutation.executedReviewCommands,
      verificationCommands: context.mutation.executedVerificationCommands,
    });
  }

  if (
    context.mutation.requiresStructuredChangeSummary &&
    !hasStructuredChangeSummary(responseContent, {
      mutationCommands: context.mutation.executedMutationCommands,
      reviewCommands: context.mutation.executedReviewCommands,
      verificationCommands: context.mutation.executedVerificationCommands,
    })
  ) {
    context.log.info({ step: context.state.step }, 'Blocking vague final answer until structured change summary is provided');
    return buildStructuredChangeSummaryRequirement(context.mutation);
  }

  return undefined;
}

function maybeFinishInterrupted(context: RunContext, logMessage: string): RunResult | undefined {
  if (!context.shouldStop?.()) {
    return undefined;
  }

  return finishInterrupted(context, logMessage);
}

function finishInterrupted(context: RunContext, logMessage: string): RunResult {
  return finishRun(context, 'interrupted', INTERRUPTED_SUMMARY, {
    logLevel: 'info',
    logMessage,
  });
}

function maybeFinishAfterConsecutiveErrors(context: RunContext, summary: string): RunResult | undefined {
  if (context.state.consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
    return undefined;
  }

  return finishRun(context, 'error', summary);
}

function finishRun(
  context: RunContext,
  outcome: StopReason,
  summary: string,
  logging?: {
    logLevel: 'info' | 'warn';
    logMessage: string;
  },
): RunResult {
  context.state.outcome = outcome;
  context.state.summary = summary;

  if (logging) {
    context.log[logging.logLevel]({ step: context.state.step, outcome, maxSteps: context.maxSteps }, logging.logMessage);
  }

  context.record({
    type: 'run.finished',
    outcome,
    summary,
    step: context.state.step,
    timestamp: context.now(),
  });

  return {
    outcome,
    summary,
    trace: context.trace.getTrace(),
    transcript: context.messages.slice(1),
    usage: context.state.usage,
  };
}
function isRunResult(value: LlmResponse | RunResult): value is RunResult {
  return 'outcome' in value;
}

function accumulateUsage(current: LlmUsage | undefined, next: LlmUsage | undefined): LlmUsage | undefined {
  if (!next) {
    return current;
  }

  if (!current) {
    return { ...next };
  }

  const cachedInputTokens = (current.cachedInputTokens ?? 0) + (next.cachedInputTokens ?? 0);
  const reasoningTokens = (current.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0);
  const requests = (current.requests ?? 0) + (next.requests ?? 0);

  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    cachedInputTokens: cachedInputTokens || undefined,
    reasoningTokens: reasoningTokens || undefined,
    requests: requests || undefined,
  };
}

function parsePlanState(output: unknown): { explanation?: string; items: PlanItem[] } | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return undefined;
  }

  const candidate = output as { explanation?: unknown; plan?: unknown };
  if (!Array.isArray(candidate.plan)) {
    return undefined;
  }

  const items = candidate.plan.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const step = typeof (item as { step?: unknown }).step === 'string' ? (item as { step: string }).step : undefined;
    const status = (item as { status?: unknown }).status;
    if (!step || typeof status !== 'string' || !PLAN_ITEM_STATUSES.has(status as PlanItem['status'])) {
      return [];
    }

    return [{ step, status: status as PlanItem['status'] }];
  });

  if (items.length === 0) {
    return undefined;
  }

  return {
    explanation: typeof candidate.explanation === 'string' ? candidate.explanation : undefined,
    items,
  };
}
