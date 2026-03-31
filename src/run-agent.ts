// ---------------------------------------------------------------------------
// runAgent — the heart of Heddle
// A minimal, executable agent loop.
// ---------------------------------------------------------------------------

import type { RunInput, RunResult, ToolDefinition, StopReason, ToolCall } from './types.js';
import type { LlmAdapter } from './llm/types.js';
import type { ChatMessage } from './llm/types.js';
import { createToolRegistry } from './tools/registry.js';
import { executeTool } from './tools/execute-tool.js';
import { createTraceRecorder } from './trace/recorder.js';
import { createBudget } from './utils/budget.js';
import { buildSystemPrompt } from './prompts/system-prompt.js';
import { logger as defaultLogger } from './utils/logger.js';
import type { Logger } from 'pino';

const DEFAULT_MAX_STEPS = 20;
const MAX_CONSECUTIVE_ERRORS = 3;

export type RunAgentOptions = {
  goal: string;
  llm: LlmAdapter;
  tools: ToolDefinition[];
  maxSteps?: number;
  logger?: Logger;
  history?: ChatMessage[];
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
    onEvent,
    approveToolCall,
    shouldStop,
    abortSignal,
  } = options;
  const registry = createToolRegistry(tools);
  const trace = createTraceRecorder();
  const budget = createBudget(maxSteps);
  const seenToolCalls = new Set<string>();

  // Start trace
  const now = () => new Date().toISOString();
  const record = (event: import('./types.js').TraceEvent) => {
    trace.record(event);
    onEvent?.(event);
  };
  let step = 0;
  let consecutiveErrors = 0;
  let pendingVerification = false;
  let pendingChangeReview = false;

  log.info({ goal, maxSteps, tools: registry.names() }, 'Agent run started');
  record({ type: 'run.started', goal, timestamp: now() });

  // Build initial messages
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(goal, registry.names()) },
    ...history,
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
      return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1) };
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
        return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1) };
      }

      response = await llm.chat(messages, registry.list(), abortSignal);
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

      // Record the assistant message with tool calls for the transcript
      messages.push({
        role: 'assistant',
        content: response.content ?? '',
        toolCalls: response.toolCalls,
      });

      // Execute each tool call
      for (const call of response.toolCalls) {
        if (shouldStop?.()) {
          outcome = 'interrupted';
          summary = 'Run interrupted by host request';
          log.info({ step, outcome }, 'Agent run interrupted before tool execution');
          record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
          return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1) };
        }

        const tool = registry.get(call.tool);
        if (tool?.requiresApproval) {
          record({ type: 'tool.approval_requested', call, step, timestamp: now() });
          const approval =
            approveToolCall ? await approveToolCall(call, tool)
            : {
                approved: false,
                reason: `No approval handler configured for ${call.tool}`,
              };
          record({
            type: 'tool.approval_resolved',
            call,
            approved: approval.approved,
            reason: approval.reason,
            step,
            timestamp: now(),
          });

          if (!approval.approved) {
            const result = {
              ok: false as const,
              error:
                approval.reason ? `Approval denied for ${call.tool}: ${approval.reason}`
                : `Approval denied for ${call.tool}`,
            };
            log.warn({ step, tool: call.tool, reason: approval.reason }, 'Tool execution denied by approval policy');
            record({ type: 'tool.result', tool: call.tool, result, step, timestamp: now() });
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              outcome = 'error';
              summary = `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors. Last error: ${result.error}`;
              record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
              return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1) };
            }
            messages.push({
              role: 'tool',
              content: JSON.stringify(result),
              toolCallId: call.id,
            });
            continue;
          }
        }

        log.info({ step, tool: call.tool }, 'Executing tool');
        record({ type: 'tool.call', call, step, timestamp: now() });

        const signature = `${call.tool}:${stableSerialize(call.input)}`;
        const result = seenToolCalls.has(signature)
          ? {
              ok: false as const,
              error: `Duplicate tool call blocked: ${call.tool} was already called with the same input earlier in this run. Try a different tool or different input.`,
            }
          : await executeTool(registry, call);
        seenToolCalls.add(signature);
        log.debug({ step, tool: call.tool, ok: result.ok }, 'Tool result');
        record({ type: 'tool.result', tool: call.tool, result, step, timestamp: now() });

        // Track consecutive errors
        if (!result.ok) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            outcome = 'error';
            summary = `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors. Last error: ${result.error}`;
            record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
            return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1) };
          }
        } else {
          consecutiveErrors = 0;
          const command = extractShellCommand(call.input);
          if (call.tool === 'run_shell_mutate' && command) {
            if (isWorkspaceChangeMutateCommand(command)) {
              pendingVerification = true;
              pendingChangeReview = true;
            }

            if (isVerificationMutateCommand(command)) {
              pendingVerification = false;
            }
          }

          if (call.tool === 'run_shell_inspect' && command && isRepoReviewCommand(command)) {
            pendingChangeReview = false;
          }
        }

        // Append tool result to transcript
        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: call.id,
        });
      }

      continue;
    }

    // Case 2: model returned content only → agent is done
    if (response.content) {
      if (pendingVerification || pendingChangeReview) {
        const hostRequirement = buildPostMutationRequirement({
          pendingVerification,
          pendingChangeReview,
        });
        log.info(
          {
            step,
            pendingVerification,
            pendingChangeReview,
          },
          'Blocking premature final answer until mutation follow-up is complete',
        );
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
      return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1) };
    }

    // Case 3: empty response — shouldn't happen but handle gracefully
    outcome = 'error';
    summary = 'Model returned an empty response';
    record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
    return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1) };
  }

  // Budget exhausted
  summary = `Reached maximum step limit (${maxSteps})`;
  log.warn({ step, maxSteps }, 'Budget exhausted');
  record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
  return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1) };
}

function extractShellCommand(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

function isWorkspaceChangeMutateCommand(command: string): boolean {
  return (
    /^yarn format\b/.test(command) ||
    /^yarn prettier\b/.test(command) ||
    /^yarn eslint\b/.test(command) ||
    /^npx prettier --write\b/.test(command) ||
    /^npx eslint --fix\b/.test(command) ||
    /^prettier --write\b/.test(command) ||
    /^eslint --fix\b/.test(command)
  );
}

function isVerificationMutateCommand(command: string): boolean {
  return (
    /^yarn test\b/.test(command) ||
    /^yarn build\b/.test(command) ||
    /^yarn lint\b/.test(command) ||
    /^yarn vitest\b/.test(command) ||
    /^vitest\b/.test(command) ||
    /^tsc\b/.test(command)
  );
}

function isRepoReviewCommand(command: string): boolean {
  return /^git status\b/.test(command) || /^git diff\b/.test(command);
}

function buildPostMutationRequirement(options: {
  pendingVerification: boolean;
  pendingChangeReview: boolean;
}): string {
  const requirements: string[] = [];

  if (options.pendingChangeReview) {
    requirements.push('inspect the resulting repo state with a git review command such as git status or git diff');
  }

  if (options.pendingVerification) {
    requirements.push('run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc');
  }

  return `Host requirement: before giving a final answer after a workspace-changing mutate command, you must ${requirements.join(' and ')}. After doing that, then provide the final answer.`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  return (
    err.name === 'AbortError' ||
    err.name === 'APIUserAbortError' ||
    /aborted/i.test(err.message)
  );
}
