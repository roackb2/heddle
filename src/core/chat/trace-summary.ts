import type { TraceEvent } from '../../index.js';
import { truncate } from '../utils/text.js';

const MAX_TOOL_CALL_SUMMARY_CHARS = 96;

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
