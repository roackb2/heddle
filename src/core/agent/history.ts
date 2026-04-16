// ---------------------------------------------------------------------------
// History sanitization for the agent loop.
// Ensures interrupted or incomplete tool-call history does not poison later turns.
// ---------------------------------------------------------------------------

import type { ChatMessage } from '../llm/types.js';
import type { ToolCall } from '../types.js';

type AssistantWithTools = { role: 'assistant'; content: string; toolCalls: ToolCall[] };
type ToolMessage = { role: 'tool'; content: string; toolCallId: string };

export function sanitizeHistory(history: ChatMessage[]): ChatMessage[] {
  const { introduced, resolved } = indexToolCallIds(history);
  return history.flatMap((message) => sanitizeMessage(message, introduced, resolved));
}

function indexToolCallIds(history: ChatMessage[]) {
  const introduced = new Set(
    history
      .filter((m): m is AssistantWithTools => m.role === 'assistant' && !!m.toolCalls)
      .flatMap((m) => m.toolCalls!.map((c) => c.id)),
  );

  const resolved = new Set(
    history
      .filter((m): m is ToolMessage => m.role === 'tool')
      .map((m) => m.toolCallId),
  );

  return { introduced, resolved };
}

function sanitizeMessage(
  message: ChatMessage,
  introduced: Set<string>,
  resolved: Set<string>,
): ChatMessage[] {
  if (message.role === 'assistant' && message.toolCalls) {
    return sanitizeAssistantWithToolCalls(message as AssistantWithTools, resolved);
  }

  if (message.role === 'tool' && !introduced.has(message.toolCallId)) {
    return [];
  }

  return [message];
}

function sanitizeAssistantWithToolCalls(
  message: AssistantWithTools,
  resolved: Set<string>,
): ChatMessage[] {
  const resolvedCalls = message.toolCalls.filter((call) => resolved.has(call.id));

  if (resolvedCalls.length > 0) {
    return [{ ...message, toolCalls: resolvedCalls }];
  }

  return message.content.trim()
    ? [{ role: 'assistant', content: message.content }]
    : [];
}
