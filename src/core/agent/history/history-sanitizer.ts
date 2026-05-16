import type { ChatMessage } from '@/core/llm/types.js';
import type { AssistantWithTools, SanitizeAgentHistoryArgs, ToolMessage } from './types.js';

/**
 * Owns history cleanup before a low-level agent run enters the model loop.
 *
 * It removes orphaned tool messages and trims interrupted assistant tool calls
 * so reused histories remain valid model input.
 */
export class AgentHistorySanitizer {
  static sanitize(args: SanitizeAgentHistoryArgs): ChatMessage[] {
    const { introduced, resolved } = AgentHistorySanitizer.indexToolCallIds(args.history);
    return args.history.flatMap((message) => AgentHistorySanitizer.sanitizeMessage(message, introduced, resolved));
  }

  private static indexToolCallIds(history: ChatMessage[]) {
    const introduced = new Set(
      history
        .filter((m): m is AssistantWithTools => m.role === 'assistant' && !!m.toolCalls)
        .flatMap((m) => m.toolCalls.map((c) => c.id)),
    );

    const resolved = new Set(
      history
        .filter((m): m is ToolMessage => m.role === 'tool')
        .map((m) => m.toolCallId),
    );

    return { introduced, resolved };
  }

  private static sanitizeMessage(
    message: ChatMessage,
    introduced: Set<string>,
    resolved: Set<string>,
  ): ChatMessage[] {
    if (message.role === 'assistant' && message.toolCalls) {
      return AgentHistorySanitizer.sanitizeAssistantWithToolCalls(message as AssistantWithTools, resolved);
    }

    if (message.role === 'tool' && !introduced.has(message.toolCallId)) {
      return [];
    }

    return [message];
  }

  private static sanitizeAssistantWithToolCalls(
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
}
