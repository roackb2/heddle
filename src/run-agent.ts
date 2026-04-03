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
const MAX_IDENTICAL_TOOL_CALLS = 2;

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
  let requiresStructuredChangeSummary = false;
  const executedMutationCommands: string[] = [];
  const executedReviewCommands: string[] = [];
  const executedVerificationCommands: string[] = [];
  const executedReviewEvidence: string[] = [];
  const executedVerificationEvidence: string[] = [];
  const sanitizedHistory = sanitizeHistory(history);

  log.info({ goal, maxSteps, tools: registry.names() }, 'Agent run started');
  record({ type: 'run.started', goal, timestamp: now() });

  // Build initial messages
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(goal, registry.names(), systemContext) },
    ...sanitizedHistory,
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

        const signature = `${call.tool}:${stableSerialize(normalizeToolInput(call.tool, call.input))}`;
        const seenCount = seenToolCalls.get(signature) ?? 0;
        const result = seenCount >= MAX_IDENTICAL_TOOL_CALLS
          ? {
              ok: false as const,
              error: `Repeated tool call blocked: ${call.tool} was already called ${MAX_IDENTICAL_TOOL_CALLS} times with the same input earlier in this run. Try a different tool or different input.`,
            }
          : await executeTool(registry, call);
        seenToolCalls.set(signature, seenCount + 1);
        log.debug({ step, tool: call.tool, ok: result.ok }, 'Tool result');
        record({ type: 'tool.result', tool: call.tool, result, step, timestamp: now() });

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
            return { outcome, summary, trace: trace.getTrace(), transcript: messages.slice(1) };
          }
        } else {
          consecutiveErrors = 0;
          const command = extractShellCommand(call.input);
          if (call.tool === 'run_shell_mutate' && command) {
            if (isWorkspaceChangeMutateCommand(command)) {
              pendingVerification = true;
              pendingChangeReview = true;
              requiresStructuredChangeSummary = true;
              executedMutationCommands.push(command);
            }

            if (isVerificationMutateCommand(command)) {
              pendingVerification = false;
              executedVerificationCommands.push(command);
            }
          }

          if (call.tool === 'edit_file') {
            pendingVerification = true;
            pendingChangeReview = true;
            requiresStructuredChangeSummary = true;
            executedMutationCommands.push(describeEditMutation(call.input));
          }

          if (call.tool === 'run_shell_inspect' && command && isRepoReviewCommand(command)) {
            pendingChangeReview = false;
            executedReviewCommands.push(command);
            executedReviewEvidence.push(summarizeCommandEvidence(result.output));
          }

          if (call.tool === 'run_shell_mutate' && command && isVerificationMutateCommand(command)) {
            executedVerificationEvidence.push(summarizeCommandEvidence(result.output));
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

      if (
        requiresStructuredChangeSummary &&
        !hasStructuredChangeSummary(response.content, {
          mutationCommands: executedMutationCommands,
          reviewCommands: executedReviewCommands,
          verificationCommands: executedVerificationCommands,
        })
      ) {
        const hostRequirement = buildStructuredChangeSummaryRequirement({
          mutationCommands: executedMutationCommands,
          reviewCommands: executedReviewCommands,
          verificationCommands: executedVerificationCommands,
          reviewEvidence: executedReviewEvidence,
          verificationEvidence: executedVerificationEvidence,
        });
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

function sanitizeHistory(history: ChatMessage[]): ChatMessage[] {
  const resolvedToolCallIds = new Set<string>();
  const introducedToolCallIds = new Set<string>();

  for (const message of history) {
    if (message.role === 'assistant' && message.toolCalls) {
      for (const call of message.toolCalls) {
        introducedToolCallIds.add(call.id);
      }
      continue;
    }

    if (message.role === 'tool') {
      resolvedToolCallIds.add(message.toolCallId);
    }
  }

  return history.flatMap((message) => {
    if (message.role === 'assistant' && message.toolCalls) {
      const resolvedToolCalls = message.toolCalls.filter((call) => resolvedToolCallIds.has(call.id));
      if (resolvedToolCalls.length > 0) {
        return [{ ...message, toolCalls: resolvedToolCalls }];
      }

      if (message.content.trim()) {
        return [{ role: 'assistant' as const, content: message.content }];
      }

      return [];
    }

    if (message.role === 'tool' && !introducedToolCallIds.has(message.toolCallId)) {
      return [];
    }

    return [message];
  });
}

function extractShellCommand(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

function describeEditMutation(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'edit_file';
  }

  const path = (input as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? `edit_file ${path.trim()}` : 'edit_file';
}

function isWorkspaceChangeMutateCommand(command: string): boolean {
  return (
    /^yarn format\b/.test(command) ||
    /^yarn prettier\b/.test(command) ||
    /^yarn eslint\b/.test(command) ||
    /^yarn add\b/.test(command) ||
    /^yarn install\b/.test(command) ||
    /^yarn remove\b/.test(command) ||
    /^mkdir\b/.test(command) ||
    /^touch\b/.test(command) ||
    /^mv\b/.test(command) ||
    /^cp\b/.test(command) ||
    /^git add\b/.test(command) ||
    /^git mv\b/.test(command) ||
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
    requirements.push(
      'inspect the resulting repo state with concrete git review evidence such as git status --short or git diff --stat',
    );
  }

  if (options.pendingVerification) {
    requirements.push('run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc');
  }

  return `Host requirement: before giving a final answer after a workspace-changing mutate command, you must ${requirements.join(' and ')}. After doing that, then provide the final answer.`;
}

function hasStructuredChangeSummary(
  content: string,
  options: {
    mutationCommands: string[];
    reviewCommands: string[];
    verificationCommands: string[];
  },
): boolean {
  const normalized = content.toLowerCase();

  if (
    !/(?:^|\n)changed\s*:/.test(normalized) ||
    !/(?:^|\n)verified\s*:/.test(normalized) ||
    !/(?:^|\n)(?:remaining uncertainty|uncertainty|remaining risks?)\s*:/.test(normalized)
  ) {
    return false;
  }

  const changedLine = extractStructuredSummaryLine(content, 'Changed');
  const verifiedLine = extractStructuredSummaryLine(content, 'Verified');
  if (!changedLine || !verifiedLine) {
    return false;
  }

  const normalizedChangedLine = changedLine.toLowerCase();
  const normalizedVerifiedLine = verifiedLine.toLowerCase();

  const mentionsMutation =
    options.mutationCommands.length === 0 ||
    options.mutationCommands.some((command) => normalizedChangedLine.includes(command.toLowerCase()));
  const mentionsReview =
    options.reviewCommands.length === 0 ||
    options.reviewCommands.some((command) => normalizedVerifiedLine.includes(command.toLowerCase()));
  const mentionsVerification =
    options.verificationCommands.length === 0 ||
    options.verificationCommands.some((command) => normalizedVerifiedLine.includes(command.toLowerCase()));

  return mentionsMutation && mentionsReview && mentionsVerification;
}

function buildStructuredChangeSummaryRequirement(options: {
  mutationCommands: string[];
  reviewCommands: string[];
  verificationCommands: string[];
  reviewEvidence: string[];
  verificationEvidence: string[];
}): string {
  const mutationSummary = options.mutationCommands.length > 0
    ? options.mutationCommands.join('; ')
    : 'workspace-changing command(s) already executed';
  const reviewSummary = options.reviewCommands.length > 0
    ? options.reviewCommands.join('; ')
    : 'no repo review command recorded';
  const verificationSummary = options.verificationCommands.length > 0
    ? options.verificationCommands.join('; ')
    : 'no verification command recorded';
  const reviewEvidenceSummary = options.reviewEvidence.length > 0
    ? options.reviewEvidence.join('; ')
    : 'no repo review evidence captured';
  const verificationEvidenceSummary = options.verificationEvidence.length > 0
    ? options.verificationEvidence.join('; ')
    : 'no verification evidence captured';

  return `Host requirement: after a workspace-changing mutate command, your final answer must be a short operator review with exactly these labels on separate lines: "Changed:", "Verified:", and "Remaining uncertainty:". In "Changed:", mention the concrete change work and name the exact command(s) or edit action used (${mutationSummary}). In "Verified:", name the exact repo review command(s) (${reviewSummary}) and exact verification command(s) (${verificationSummary}), and ground them in concrete evidence from the command results (${reviewEvidenceSummary}; ${verificationEvidenceSummary}). If nothing remains uncertain, explicitly write "Remaining uncertainty: none".`;
}

function extractStructuredSummaryLine(content: string, label: 'Changed' | 'Verified'): string | undefined {
  const match = content.match(new RegExp(`(?:^|\\n)${label}\\s*:\\s*([^\\n]+)`, 'i'));
  return match?.[1]?.trim();
}

function summarizeCommandEvidence(output: unknown): string {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return 'no structured command output recorded';
  }

  const candidate = output as {
    command?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
  };
  const command = typeof candidate.command === 'string' && candidate.command.trim() ? candidate.command.trim() : 'command';
  const stdout = typeof candidate.stdout === 'string' ? candidate.stdout.trim() : '';
  const stderr = typeof candidate.stderr === 'string' ? candidate.stderr.trim() : '';
  const exitCode = typeof candidate.exitCode === 'number' ? candidate.exitCode : 0;
  const body = stdout || stderr;
  const snippet = body ? body.replace(/\s+/g, ' ').slice(0, 120) : 'no stdout/stderr output';
  return `${command} => exit ${exitCode}, ${snippet}`;
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

function normalizeToolInput(tool: string, input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const normalized = { ...(input as Record<string, unknown>) };

  if ((tool === 'list_files' || tool === 'read_file' || tool === 'search_files') && typeof normalized.path === 'string') {
    normalized.path = normalizePathValue(normalized.path);
  }

  if (tool === 'edit_file' && typeof normalized.path === 'string') {
    normalized.path = normalizePathValue(normalized.path);
  }

  if ((tool === 'run_shell_inspect' || tool === 'run_shell_mutate') && typeof normalized.command === 'string') {
    normalized.command = normalized.command.trim().replace(/\s+/g, ' ');
  }

  return normalized;
}

function normalizePathValue(path: string): string {
  const trimmed = path.trim();
  if (trimmed === './' || trimmed === '.') {
    return '.';
  }

  return trimmed.replace(/\/+$/, '') || '.';
}

function isRecoverableToolError(error: string | undefined): boolean {
  if (!error) {
    return false;
  }

  return error.startsWith('Invalid input for ') || error.startsWith('Repeated tool call blocked:');
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
