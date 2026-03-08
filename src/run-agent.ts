// ---------------------------------------------------------------------------
// runAgent — the heart of Heddle
// A minimal, executable agent loop.
// ---------------------------------------------------------------------------

import type { RunInput, RunResult, ToolDefinition, TraceEvent, StopReason } from './types.js';
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
  const { goal, llm, tools, maxSteps = DEFAULT_MAX_STEPS, logger: log = defaultLogger } = options;
  const registry = createToolRegistry(tools);
  const trace = createTraceRecorder();
  const budget = createBudget(maxSteps);

  // Start trace
  const now = () => new Date().toISOString();
  let step = 0;
  let consecutiveErrors = 0;

  log.info({ goal, maxSteps, tools: registry.names() }, 'Agent run started');
  trace.record({ type: 'run.started', goal, timestamp: now() });

  // Build initial messages
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(goal, registry.names()) },
    { role: 'user', content: goal },
  ];

  let outcome: StopReason = 'max_steps';
  let summary = '';

  while (!budget.exhausted()) {
    step++;
    budget.step();

    // Call LLM
    log.debug({ step, budgetRemaining: budget.remaining() }, 'Calling LLM');
    let response;
    try {
      response = await llm.chat(messages, registry.list());
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ step, error: errMsg }, 'LLM call failed');
      trace.record({
        type: 'run.finished',
        outcome: 'error',
        summary: `LLM error: ${errMsg}`,
        step,
        timestamp: now(),
      });
      return { outcome: 'error', summary: `LLM error: ${errMsg}`, trace: trace.getTrace() };
    }

    // Case 1: model returned tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      // If there's also content, record it
      if (response.content) {
        trace.record({ type: 'model.message', content: response.content, step, timestamp: now() });
      }

      // Record the assistant message with tool calls for the transcript
      messages.push({
        role: 'assistant',
        content: response.content ?? '',
        toolCalls: response.toolCalls,
      });

      // Execute each tool call
      for (const call of response.toolCalls) {
        log.info({ step, tool: call.tool }, 'Executing tool');
        trace.record({ type: 'tool.call', call, step, timestamp: now() });

        const result = await executeTool(registry, call);
        log.debug({ step, tool: call.tool, ok: result.ok }, 'Tool result');
        trace.record({ type: 'tool.result', tool: call.tool, result, step, timestamp: now() });

        // Track consecutive errors
        if (!result.ok) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            outcome = 'error';
            summary = `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors. Last error: ${result.error}`;
            trace.record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
            return { outcome, summary, trace: trace.getTrace() };
          }
        } else {
          consecutiveErrors = 0;
        }

        // Append tool result to transcript
        messages.push({
          role: 'tool',
          content: JSON.stringify(result.output ?? result.error ?? ''),
          toolCallId: call.id,
        });
      }

      continue;
    }

    // Case 2: model returned content only → agent is done
    if (response.content) {
      trace.record({ type: 'model.message', content: response.content, step, timestamp: now() });
      messages.push({ role: 'assistant', content: response.content });

      outcome = 'done';
      summary = response.content;
      log.info({ step, outcome }, 'Agent run finished');
      trace.record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
      return { outcome, summary, trace: trace.getTrace() };
    }

    // Case 3: empty response — shouldn't happen but handle gracefully
    outcome = 'error';
    summary = 'Model returned an empty response';
    trace.record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
    return { outcome, summary, trace: trace.getTrace() };
  }

  // Budget exhausted
  summary = `Reached maximum step limit (${maxSteps})`;
  log.warn({ step, maxSteps }, 'Budget exhausted');
  trace.record({ type: 'run.finished', outcome, summary, step, timestamp: now() });
  return { outcome, summary, trace: trace.getTrace() };
}
