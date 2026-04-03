// ---------------------------------------------------------------------------
// runAgent — the heart of Heddle
// A minimal, executable agent loop.
// ---------------------------------------------------------------------------

import type { RunInput, RunResult, ToolDefinition, StopReason, ToolCall } from './types.js';
import type { LlmAdapter, LlmUsage } from './llm/types.js';
import type { ChatMessage } from './llm/types.js';
import { createToolRegistry } from './tools/registry.js';
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

const DEFAULT_MAX_STEPS = 20;
const MAX_CONSECUTIVE_ERRORS = 3;

export type RunAgentOptions = {
  goal: string;
  llm: LlmAdapter;
  tools: ToolDefinition[];
  maxSteps?: number;
  logger?: Logger;
  history?: ChatMessage[];
  systemContext?: string;
  onEvent?: (event: import('./types.js').TraceEvent) => void;
  approveToolCall?: (call: ToolCall, tool: ToolDefinition) => Promise<{ approved: boolean; reason?: string }>;
  shouldStop?: () => boolean;
  abortSignal?: AbortSignal;
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
  const {
    goal,
    llm,
    tools,
    maxSteps = DEFAULT_MAX_STEPS,
    logger: log = defaultLogger,
    history = [],
    systemContext,
    onEvent,
    approveToolCall,
    shouldStop,
    abortSignal,
  } = options;
  const registry = createToolRegistry(tools);
  const trace = createTraceRecorder();
  const budget = createBudget(maxSteps);
  const seenToolCalls = new Map<string, number>();
  const mutation = createMutationState();
  const progress = createProgressReminderState();

  // Start trace
  const now = () => new Date().toISOString();
  const record = (event: import('./types.js').TraceEvent) => {
    trace.record(event);
    onEvent?.(event);
  };
  let step = 0;
  let consecutiveErrors = 0;
  let usage: LlmUsage | undefined;

  log.info({ goal, maxSteps, tools: registry.names() }, 'Agent run started');
  record({ type: 'run.started', goal, timestamp: now() });

  // Build initial messages
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(goal, registry.names(), systemContext) },
    ...sanitizeHistory(history),
    { role: 'user', content: goal },
  ];

  let outcome: StopReason = 'max_steps';
  let summary = '';

  while (!budget.exhausted()) {
    if (shouldStop?.()) {
      outcome = 'interrupted';
      summary = 'Run interrupted by host request';
      log.info({ step, outcome }, 'Agent run interrupted before next step');
      record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
      return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1), usage };
    }

    step++;
    budget.step();

    // Call LLM
    log.debug({ step, budgetRemaining: budget.remaining() }, 'Calling LLM');
    let response;
    try {
      if (abortSignal?.aborted) {
        outcome = 'interrupted';
        summary = 'Run interrupted by host request';
        log.info({ step, outcome }, 'Agent run interrupted before LLM call');
        record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
        return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1), usage };
      }

      response = await llm.chat(messages, registry.list(), abortSignal);
      usage = accumulateUsage(usage, response.usage);
    } catch (err) {
      if (isAbortError(err) || abortSignal?.aborted || shouldStop?.()) {
        outcome = 'interrupted';
        summary = 'Run interrupted by host request';
        log.info({ step, outcome }, 'Agent run interrupted during LLM call');
        record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
        return {
          outcome,
          summary,
          trace: trace.getTrace(),
          transcript: messages.slice(1),
          usage,
        };
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ step, error: errMsg }, 'LLM call failed');
      record({
        type: 'run.finished',
        outcome: 'error',
        summary: `LLM error: ${errMsg}`,
        step,
        timestamp: now(),
      });
      return {
        outcome: 'error',
        summary: `LLM error: ${errMsg}`,
        trace: trace.getTrace(),
        transcript: messages.slice(1),
        usage,
      };
    }

    // Case 1: model returned tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      record({
        type: 'assistant.turn',
        content: response.content ?? '',
        diagnostics: response.diagnostics,
        requestedTools: true,
        toolCalls: response.toolCalls,
        step,
        timestamp: now(),
      });

      messages.push({
        role: 'assistant',
        content: response.content ?? '',
        toolCalls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        if (shouldStop?.()) {
          outcome = 'interrupted';
          summary = 'Run interrupted by host request';
          log.info({ step, outcome }, 'Agent run interrupted before tool execution');
          record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
          return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1), usage };
        }

        const tool = registry.get(call.tool);
        const approvalDeniedResult = await maybeDenyToolCall({
          call,
          tool,
          step,
          now,
          approveToolCall,
          record,
          log,
        });
        if (approvalDeniedResult) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            outcome = 'error';
            summary = `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors. Last error: ${approvalDeniedResult.error}`;
            record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
            return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1), usage };
          }
          messages.push({
            role: 'tool',
            content: JSON.stringify(approvalDeniedResult),
            toolCallId: call.id,
          });
          continue;
        }

        const execution = await executeToolCallWithFallback({
          call,
          step,
          now,
          registry,
          seenToolCalls,
          approveToolCall,
          record,
          log,
        });
        const { effectiveCall, result } = execution;

        // Track consecutive errors
        if (!result.ok) {
          if (isRecoverableToolError(result.error)) {
            messages.push({
              role: 'system',
              content:
                `Host reminder: the last tool call failed due to invalid or repeated tool use: ${result.error}. Correct the call immediately, switch tools, or use report_state if you are blocked. Do not keep retrying the same failing pattern.`,
            });
          } else {
            consecutiveErrors++;
          }
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            outcome = 'error';
            summary = `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors. Last error: ${result.error}`;
            record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
            return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1), usage };
          }
        } else {
          consecutiveErrors = 0;
          trackToolResult(mutation, effectiveCall, result);
        }

        messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: call.id,
        });

        const reminders = buildProgressReminders(progress, {
          effectiveCall,
          result,
          remainingSteps: budget.remaining(),
        });
        for (const reminder of reminders) {
          messages.push({ role: 'system', content: reminder });
        }
      }

      continue;
    }

    // Case 2: model returned content only → agent is done
    if (response.content) {
      if (mutation.pendingVerification || mutation.pendingChangeReview) {
        const hostRequirement = buildPostMutationRequirement({
          pendingVerification: mutation.pendingVerification,
          pendingChangeReview: mutation.pendingChangeReview,
        });
        log.info(
          {
            step,
            pendingVerification: mutation.pendingVerification,
            pendingChangeReview: mutation.pendingChangeReview,
          },
          'Blocking premature final answer until mutation follow-up is complete',
        );
        messages.push({ role: 'system', content: hostRequirement });
        continue;
      }

      if (
        mutation.requiresStructuredChangeSummary &&
        !hasStructuredChangeSummary(response.content, {
          mutationCommands: mutation.executedMutationCommands,
          reviewCommands: mutation.executedReviewCommands,
          verificationCommands: mutation.executedVerificationCommands,
        })
      ) {
        const hostRequirement = buildStructuredChangeSummaryRequirement(mutation);
        log.info({ step }, 'Blocking vague final answer until structured change summary is provided');
        messages.push({ role: 'system', content: hostRequirement });
        continue;
      }

      record({
        type: 'assistant.turn',
        content: response.content,
        diagnostics: response.diagnostics,
        requestedTools: false,
        step,
        timestamp: now(),
      });
      messages.push({ role: 'assistant', content: response.content });

      outcome = 'done';
      summary = response.content;
      log.info({ step, outcome }, 'Agent run finished');
      record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
      return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1), usage };
    }

    // Case 3: empty response — shouldn't happen but handle gracefully
    outcome = 'error';
    summary = 'Model returned an empty response';
    record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
    return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1), usage };
  }

  // Budget exhausted
  summary = `Reached maximum step limit (${maxSteps})`;
  log.warn({ step, maxSteps }, 'Budget exhausted');
  record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
  return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1), usage };
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
