import type { ChatMessage, TraceEvent } from '../../index.js';
import { isCompactedHistorySummary } from './compaction.js';
import type { ConversationLine } from './types.js';

const MAX_TOOL_CALL_SUMMARY_CHARS = 96;

export type ChatFailureHintOptions = {
  model: string;
  estimatedHistoryTokens?: number;
};

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
          `tool result ${event.tool}: ${event.result.ok ? 'ok' : event.result.error ?? 'error'}`,
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

export function formatChatFailureMessage(message: string, options: ChatFailureHintOptions): string {
  if (looksLikeAnthropicInputRateLimit(message)) {
    const sizeHint =
      typeof options.estimatedHistoryTokens === 'number' ?
        ` Current session history is estimated at about ${options.estimatedHistoryTokens.toLocaleString()} tokens before the next request.`
      : '';
    return `${message}\n\nThis likely failed because the current prompt plus session history are too large for ${options.model}'s input-token-per-minute limit.${sizeHint} Try /compact, /clear, or /session new, then retry.`;
  }

  if (looksLikeOpenAiQuotaError(message)) {
    return `${message}\n\nThis looks like an OpenAI quota or billing limit for the active key, not a transient prompt-size issue. Switch providers or check the OpenAI account quota and billing state.`;
  }

  return message;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function summarizeToolCall(tool: string, input: unknown): string {
  const shellCommand = extractShellCommand(input);
  if (shellCommand) {
    return `${tool} (${truncate(shellCommand, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  const path = extractPathField(input);
  if (path) {
    return `${tool} (${truncate(path, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  return tool;
}

function extractShellCommand(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const command = (value as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

function extractPathField(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const path = (value as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? path.trim() : undefined;
}

function renderToolHistoryMessage(message: Extract<ChatMessage, { role: 'tool' }>, history: ChatMessage[], index: number): string | undefined {
  const priorAssistant = findPriorAssistantWithToolCall(history, index, message.toolCallId);
  const toolName = priorAssistant?.toolCalls?.find((call) => call.id === message.toolCallId)?.tool ?? 'tool';
  const summary = message.content.trim();
  if (!summary) {
    return `${toolName} returned no visible output.`;
  }

  return `${toolName}: ${summary}`;
}

function findPriorAssistantWithToolCall(history: ChatMessage[], index: number, toolCallId: string) {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const candidate = history[cursor];
    if (candidate?.role !== 'assistant' || !candidate.toolCalls?.length) {
      continue;
    }

    if (candidate.toolCalls.some((call) => call.id === toolCallId)) {
      return candidate;
    }
  }

  return undefined;
}

function looksLikeAnthropicInputRateLimit(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('input tokens per minute')
    || (normalized.includes('reduce the prompt length') && normalized.includes('maximum tokens requested'))
    || (normalized.includes('rate_limit_error') && normalized.includes('tokens per minute'))
  );
}

function looksLikeOpenAiQuotaError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('exceeded your current quota')
    || (normalized.includes('billing details') && normalized.includes('quota'))
  );
}
