import type { ChatMessage, ToolCall, TraceEvent, ToolResult } from '../../../index.js';
import {
  classifyShellCommandPolicy,
  DEFAULT_MUTATE_RULES,
  type RunShellPolicyDecision,
} from '../../../tools/run-shell.js';
import { isCompactedHistorySummary } from '../state/compaction.js';
import type { ConversationLine, LiveEvent, PendingApproval } from '../state/types.js';

const MAX_SHELL_OUTPUT_CHARS = 1400;
const MAX_TOOL_CALL_SUMMARY_CHARS = 96;

export function buildConversationMessages(history: ChatMessage[]): ConversationLine[] {
  return history.flatMap((message, index) => {
    if (isCompactedHistorySummary(message)) {
      return [{
        id: `compacted-${index}`,
        role: 'assistant',
        text: 'Earlier conversation history was compacted to preserve context for longer chats.',
      }];
    }

    if (message.role === 'user' || message.role === 'assistant') {
      if (!message.content.trim()) {
        return [];
      }

      return [{ id: `${message.role}-${index}-${message.content}`, role: message.role, text: message.content }];
    }

    if (message.role === 'tool') {
      const rendered = renderToolHistoryMessage(message, history, index);
      if (!rendered) {
        return [];
      }

      return [{ id: `tool-${index}-${rendered}`, role: 'assistant', text: rendered }];
    }

    return [];
  });
}

export function summarizeTrace(trace: TraceEvent[]): string[] {
  return trace.flatMap((event) => {
    switch (event.type) {
      case 'assistant.turn':
        return [
          ...(event.diagnostics?.rationale ? [`reasoning: ${truncate(event.diagnostics.rationale, 140)}`] : []),
          event.requestedTools ?
            `assistant requested ${event.toolCalls?.map((call) => summarizeToolCall(call.tool, call.input)).join(', ')}`
          : 'assistant answered',
        ];
      case 'tool.approval_requested':
        return [`approval requested for ${summarizeToolCall(event.call.tool, event.call.input)}`];
      case 'tool.approval_resolved':
        return [
          `approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}${event.reason ? ` (${truncate(event.reason, 80)})` : ''}`,
        ];
      case 'tool.fallback':
        return [
          `fallback ${summarizeToolCall(event.fromCall.tool, event.fromCall.input)} -> ${summarizeToolCall(event.toCall.tool, event.toCall.input)} (${event.reason})`,
        ];
      case 'tool.call':
        return [`tool call ${summarizeToolCall(event.call.tool, event.call.input)}`];
      case 'tool.result':
        return [
          `tool result ${summarizeToolResult(event.tool, extractShellCommand(event.result.output), event.result.output)}: ${event.result.ok ? 'ok' : event.result.error ?? 'error'}`,
        ];
      case 'run.finished':
        return [`run finished: ${event.outcome}`];
      default:
        return [];
    }
  });
}

export function countAssistantSteps(trace: TraceEvent[]): number {
  return trace.filter((event) => event.type === 'assistant.turn').length;
}

export function toLiveEvent(event: TraceEvent): string | undefined {
  switch (event.type) {
    case 'run.started':
      return 'thinking';
    case 'assistant.turn':
      if (event.diagnostics?.rationale) {
        return `reasoning: ${truncate(event.diagnostics.rationale, 140)}`;
      }
      if (event.requestedTools) {
        return undefined;
      }
      return 'answer ready';
    case 'tool.approval_requested':
      return `approval needed for ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.approval_resolved':
      return `approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}${event.reason ? ` (${truncate(event.reason, 80)})` : ''}`;
    case 'tool.fallback':
      return `retrying with ${summarizeToolCall(event.toCall.tool, event.toCall.input)} after ${summarizeToolCall(event.fromCall.tool, event.fromCall.input)} was blocked (${truncate(event.reason, 80)})`;
    case 'tool.call':
      return `running ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.result':
      return `${summarizeToolResult(event.tool, extractShellCommand(event.result.output), event.result.output)} ${event.result.ok ? 'completed' : `failed: ${event.result.error ?? 'error'}`}`;
    case 'run.finished':
      return event.outcome === 'done' ? undefined : `stopped: ${event.outcome}`;
    default:
      return undefined;
  }
}

export function currentActivityText(
  liveEvents: LiveEvent[],
  isRunning: boolean,
  elapsedSeconds: number,
  pendingApproval?: PendingApproval,
  interruptRequested?: boolean,
): string {
  if (pendingApproval) {
    return formatApprovalPrompt(pendingApproval);
  }

  if (interruptRequested) {
    return 'interrupt requested; waiting for the current step to finish';
  }

  const current = liveEvents[liveEvents.length - 1]?.text;
  if (isRunning) {
    return current ? `${current} · ${elapsedSeconds}s` : 'waiting for first agent event...';
  }

  return current ?? 'idle';
}

export function formatApprovalPrompt(pendingApproval: PendingApproval): string {
  const command = extractShellCommand(pendingApproval.call.input);
  if (command) {
    const policy = describePendingApprovalPolicy(pendingApproval);
    if (policy) {
      return `Allow ${policy.scope} mutation command (${policy.capability}, ${policy.risk} risk): ${truncate(command, 120)}`;
    }

    return `Allow mutation command: ${truncate(command, 120)}`;
  }

  const editPath = extractEditPath(pendingApproval.call.input);
  if (pendingApproval.call.tool === 'edit_file' && editPath) {
    return `Allow edit_file on ${truncate(editPath, 120)}`;
  }

  return `Allow ${pendingApproval.call.tool}`;
}

export function formatApprovalHint(pendingApproval: PendingApproval): string {
  const policy = describePendingApprovalPolicy(pendingApproval);
  const policySummary = policy ? ` • ${policy.scope} • ${policy.capability} • ${policy.risk} risk` : '';
  const rememberLabel = pendingApproval.rememberLabel ? `A ${pendingApproval.rememberLabel}` : 'A allow for project';
  return `Tool: ${pendingApproval.call.tool}${policySummary} • Y approve • ${rememberLabel} • N deny`;
}

export function summarizeToolCall(tool: string, input: unknown): string {
  const planSummary = summarizePlanInput(tool, input);
  if (planSummary) {
    return planSummary;
  }

  const shellCommand = extractShellCommand(input);
  if (shellCommand) {
    return `${tool} (${truncate(shellCommand, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  const searchSummary = summarizeSearchInput(tool, input);
  if (searchSummary) {
    return searchSummary;
  }

  const path = extractPathField(input);
  if (isPathAwareTool(tool) && path) {
    return `${tool} (${truncate(path, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  return tool;
}

export function summarizeToolResult(tool: string, command: string | undefined, output?: unknown): string {
  if (command) {
    return `${tool} (${truncate(command, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  const outputPath = extractOutputPath(output);
  if (tool === 'edit_file' && outputPath) {
    return `${tool} (${truncate(outputPath, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  return tool;
}

export function extractShellCommand(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const command = (value as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

export function extractEditPath(value: unknown): string | undefined {
  return extractPathField(value);
}

export function extractPathField(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const path = (value as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? path.trim() : undefined;
}

export function extractQueryField(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const query = (value as { query?: unknown }).query;
  return typeof query === 'string' && query.trim() ? query.trim() : undefined;
}

export function extractOutputPath(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const path = (value as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? path.trim() : undefined;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

export function normalizeInlineText(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

export function shouldFallbackToMutate(error: string | undefined): boolean {
  if (!error) {
    return false;
  }

  return error.includes('run_shell_inspect policy') || error.includes('Inspect mode permits read-only pipes');
}

export function formatDirectShellResponse(toolName: string, command: string, result: ToolResult): string {
  const lines = [
    '## Direct shell result',
    '',
    `Command: \`${command}\``,
    `Tool: ${toolName}`,
  ];

  const policy = extractPolicySummary(result.output);
  if (policy) {
    lines.push(`Policy: ${policy}`);
  }

  if (result.ok) {
    const stdout = extractTextOutput(result.output, 'stdout');
    const stderr = extractTextOutput(result.output, 'stderr');
    lines.push('Outcome: success');
    if (stdout) {
      lines.push('', '### stdout', '```text', truncate(stdout, MAX_SHELL_OUTPUT_CHARS), '```');
    }
    if (stderr) {
      lines.push('', '### stderr', '```text', truncate(stderr, MAX_SHELL_OUTPUT_CHARS), '```');
    }
    if (!stdout && !stderr) {
      lines.push('', 'No stdout or stderr output.');
    }
    return lines.join('\n');
  }

  lines.push('Outcome: failed');
  if (result.error) {
    lines.push('', `Error: ${result.error}`);
  }
  const stdout = extractTextOutput(result.output, 'stdout');
  const stderr = extractTextOutput(result.output, 'stderr');
  if (stdout) {
    lines.push('', '### stdout', '```text', truncate(stdout, MAX_SHELL_OUTPUT_CHARS), '```');
  }
  if (stderr) {
    lines.push('', '### stderr', '```text', truncate(stderr, MAX_SHELL_OUTPUT_CHARS), '```');
  }
  return lines.join('\n');
}

export function extractTextOutput(value: unknown, field: 'stdout' | 'stderr'): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

export function extractPolicySummary(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const policy = (value as { policy?: unknown }).policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return undefined;
  }

  const candidate = policy as Record<string, unknown>;
  const scope = typeof candidate.scope === 'string' ? candidate.scope : undefined;
  const risk = typeof candidate.risk === 'string' ? candidate.risk : undefined;
  const reason = typeof candidate.reason === 'string' ? candidate.reason : undefined;
  const parts = [scope, risk, reason].filter(Boolean);
  return parts.length > 0 ? parts.join(' • ') : undefined;
}

function describePendingApprovalPolicy(pendingApproval: PendingApproval): RunShellPolicyDecision | undefined {
  if (pendingApproval.call.tool !== 'run_shell_mutate') {
    return undefined;
  }

  const command = extractShellCommand(pendingApproval.call.input);
  if (!command) {
    return undefined;
  }

  const result = classifyShellCommandPolicy(command, {
    toolName: 'run_shell_mutate',
    rules: DEFAULT_MUTATE_RULES,
    allowUnknown: true,
  });

  return 'error' in result ? undefined : result;
}

export function isGenericSessionName(name: string): boolean {
  return /^Session \d+$/.test(name.trim());
}

export function normalizeSessionTitle(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return undefined;
  }

  return truncate(normalized, 48);
}

function isPathAwareTool(tool: string): boolean {
  return tool === 'edit_file' || tool === 'read_file' || tool === 'list_files';
}

function summarizeSearchInput(tool: string, input: unknown): string | undefined {
  if (tool !== 'search_files') {
    return undefined;
  }

  const query = extractQueryField(input);
  if (!query) {
    return tool;
  }

  const path = extractPathField(input);
  const querySummary = truncate(JSON.stringify(query), Math.max(12, Math.floor(MAX_TOOL_CALL_SUMMARY_CHARS / 2)));
  if (path) {
    return `${tool} (${querySummary} in ${truncate(path, Math.max(12, Math.floor(MAX_TOOL_CALL_SUMMARY_CHARS / 2)))})`;
  }

  return `${tool} (${querySummary})`;
}

function summarizePlanInput(tool: string, input: unknown): string | undefined {
  if (tool !== 'update_plan') {
    return undefined;
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return tool;
  }

  const plan = (input as { plan?: unknown }).plan;
  if (!Array.isArray(plan) || plan.length === 0) {
    return tool;
  }

  const current = plan.find((item) => item && typeof item === 'object' && !Array.isArray(item) && (item as { status?: unknown }).status === 'in_progress');
  const currentStep = current && typeof (current as { step?: unknown }).step === 'string' ? (current as { step: string }).step : undefined;
  return currentStep ? `${tool} (${truncate(currentStep, MAX_TOOL_CALL_SUMMARY_CHARS)})` : `${tool} (${plan.length} items)`;
}

function renderToolHistoryMessage(message: Extract<ChatMessage, { role: 'tool' }>, history: ChatMessage[], index: number): string | undefined {
  const toolCall = findToolCallForResult(history, index, message.toolCallId);
  if (!toolCall) {
    return undefined;
  }

  const result = parseToolResultPayload(message.content);
  if (!result?.ok) {
    return undefined;
  }

  if (toolCall.tool === 'update_plan') {
    return renderUpdatePlanHistoryMessage(result.output);
  }

  if (toolCall.tool !== 'edit_file') {
    return undefined;
  }

  const editResult = parseEditFileResult(result.output);
  if (!editResult) {
    return undefined;
  }

  const lines = [
    `## Edited \`${editResult.path}\``,
    '',
    `Action: ${editResult.action}`,
  ];

  if (typeof editResult.matchCount === 'number') {
    lines.push(`Matches changed: ${editResult.matchCount}`);
  }

  lines.push(`Bytes written: ${editResult.bytesWritten}`);

  if (editResult.diff?.diff) {
    lines.push('', '```diff', editResult.diff.diff, '```');
    if (editResult.diff.truncated) {
      lines.push('', 'Preview truncated.');
    }
  }

  return lines.join('\n');
}

function renderUpdatePlanHistoryMessage(output: unknown): string | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return undefined;
  }

  const candidate = output as { explanation?: unknown; plan?: unknown };
  if (!Array.isArray(candidate.plan) || candidate.plan.length === 0) {
    return undefined;
  }

  const lines = ['## Plan'];
  if (typeof candidate.explanation === 'string' && candidate.explanation.trim()) {
    lines.push('', candidate.explanation.trim());
  }

  lines.push(
    '',
    ...candidate.plan.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return [];
      }

      const step = typeof (item as { step?: unknown }).step === 'string' ? (item as { step: string }).step.trim() : '';
      const status = (item as { status?: unknown }).status;
      if (!step || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
        return [];
      }

      return [`- ${planStatusMarker(status)} ${step}`];
    }),
  );

  return lines.join('\n');
}

function planStatusMarker(status: 'pending' | 'in_progress' | 'completed'): string {
  if (status === 'completed') {
    return '[x]';
  }
  if (status === 'in_progress') {
    return '[-]';
  }
  return '[ ]';
}

function findToolCallForResult(history: ChatMessage[], index: number, toolCallId: string): ToolCall | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const message = history[cursor];
    if (message?.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }

    const match = message.toolCalls.find((call) => call.id === toolCallId);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function parseToolResultPayload(content: string): ToolResult | undefined {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.ok !== 'boolean') {
      return undefined;
    }

    return parsed as ToolResult;
  } catch {
    return undefined;
  }
}

type EditFileHistoryResult = {
  path: string;
  action: string;
  bytesWritten: number;
  matchCount?: number;
  diff?: {
    diff: string;
    truncated: boolean;
  };
};

function parseEditFileResult(output: unknown): EditFileHistoryResult | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return undefined;
  }

  const candidate = output as Record<string, unknown>;
  if (typeof candidate.path !== 'string' || typeof candidate.action !== 'string' || typeof candidate.bytesWritten !== 'number') {
    return undefined;
  }

  const diff =
    candidate.diff && typeof candidate.diff === 'object' && !Array.isArray(candidate.diff) ?
      parseEditDiff(candidate.diff)
    : undefined;

  return {
    path: candidate.path,
    action: candidate.action,
    bytesWritten: candidate.bytesWritten,
    matchCount: typeof candidate.matchCount === 'number' ? candidate.matchCount : undefined,
    diff,
  };
}

function parseEditDiff(value: unknown): { diff: string; truncated: boolean } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.diff !== 'string' || typeof candidate.truncated !== 'boolean') {
    return undefined;
  }

  return {
    diff: candidate.diff,
    truncated: candidate.truncated,
  };
}

export function appendDirectShellHistory(
  history: ChatMessage[],
  shellDisplay: string,
  toolName: string,
  result: ToolResult,
): ChatMessage[] {
  const summary = buildDirectShellHistorySummary(toolName, result);
  const userMessage: ChatMessage = { role: 'user', content: shellDisplay };
  const assistantMessage: ChatMessage = { role: 'assistant', content: summary };
  return [...history, userMessage, assistantMessage];
}

function buildDirectShellHistorySummary(toolName: string, result: ToolResult): string {
  const lines = [`## Direct shell command via \`${toolName}\``];
  const policy = extractPolicySummary(result.output);
  if (policy) {
    lines.push(`Policy: ${policy}`);
  }
  lines.push(`Outcome: ${result.ok ? 'success' : 'failure'}`);
  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  const stdout = extractTextOutput(result.output, 'stdout');
  const stderr = extractTextOutput(result.output, 'stderr');
  if (stdout) {
    lines.push('### stdout', '```text', truncate(stdout, 1200), '```');
  }
  if (stderr) {
    lines.push('### stderr', '```text', truncate(stderr, 800), '```');
  }

  return lines.join('\n\n');
}
