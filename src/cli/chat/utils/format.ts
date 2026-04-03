import type { ChatMessage, TraceEvent, ToolResult } from '../../../index.js';
import type { ConversationLine, LiveEvent, PendingApproval } from '../state/types.js';

const MAX_SHELL_OUTPUT_CHARS = 1400;
const MAX_TOOL_CALL_SUMMARY_CHARS = 96;

export function buildConversationMessages(history: ChatMessage[]): ConversationLine[] {
  return history.flatMap((message, index) => {
    if (message.role === 'user' || message.role === 'assistant') {
      if (!message.content.trim()) {
        return [];
      }

      return [{ id: `${message.role}-${index}-${message.content}`, role: message.role, text: message.content }];
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
        return [`approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}`];
      case 'tool.call':
        return [`tool call ${summarizeToolCall(event.call.tool, event.call.input)}`];
      case 'tool.result':
        return [
          `tool result ${summarizeToolResult(event.tool, extractShellCommand(event.result.output))}: ${event.result.ok ? 'ok' : event.result.error ?? 'error'}`,
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
      return `approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.call':
      return `running ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.result':
      return `${summarizeToolResult(event.tool, extractShellCommand(event.result.output))} ${event.result.ok ? 'completed' : `failed: ${event.result.error ?? 'error'}`}`;
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
    return `Allow mutation command: ${truncate(command, 120)}`;
  }

  return `Allow ${pendingApproval.call.tool}`;
}

export function formatApprovalHint(pendingApproval: PendingApproval): string {
  return `Tool: ${pendingApproval.call.tool}`;
}

export function summarizeToolCall(tool: string, input: unknown): string {
  const shellCommand = extractShellCommand(input);
  if (shellCommand) {
    return `${tool} (${truncate(shellCommand, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  return tool;
}

export function summarizeToolResult(tool: string, command: string | undefined): string {
  if (command) {
    return `${tool} (${truncate(command, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
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

  return error.includes('run_shell_inspect policy');
}

export function formatDirectShellResponse(toolName: string, command: string, result: ToolResult): string {
  const lines = [
    'Direct shell result',
    '',
    `Command: ${command}`,
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
      lines.push('', 'stdout:', truncate(stdout, MAX_SHELL_OUTPUT_CHARS));
    }
    if (stderr) {
      lines.push('', 'stderr:', truncate(stderr, MAX_SHELL_OUTPUT_CHARS));
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
    lines.push('', 'stdout:', truncate(stdout, MAX_SHELL_OUTPUT_CHARS));
  }
  if (stderr) {
    lines.push('', 'stderr:', truncate(stderr, MAX_SHELL_OUTPUT_CHARS));
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

export function appendDirectShellHistory(
  history: ChatMessage[],
  shellDisplay: string,
  toolName: string,
  result: ToolResult,
): ChatMessage[] {
  const summary = buildDirectShellHistorySummary(toolName, result);
  const userMessage: ChatMessage = { role: 'user', content: shellDisplay };
  const assistantMessage: ChatMessage = { role: 'assistant', content: summary };
  return [...history, userMessage, assistantMessage].slice(-60);
}

function buildDirectShellHistorySummary(toolName: string, result: ToolResult): string {
  const lines = [`Direct shell command via ${toolName}.`];
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
    lines.push(`stdout:\n${truncate(stdout, 1200)}`);
  }
  if (stderr) {
    lines.push(`stderr:\n${truncate(stderr, 800)}`);
  }

  return lines.join('\n\n');
}
