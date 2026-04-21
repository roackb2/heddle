import type { ChatMessage } from '../../index.js';
import { isCompactedHistorySummary } from './compaction.js';
import type { ConversationLine } from './types.js';

export function buildConversationMessages(history: ChatMessage[]): ConversationLine[] {
  return history.flatMap((message, index) => {
    if (isCompactedHistorySummary(message)) {
      const archiveRootMatch = message.content.match(/Archive root:\s*(.+)/);
      return [{
        id: `compacted-${index}`,
        role: 'assistant',
        text:
          archiveRootMatch ?
            `Earlier conversation history was summarized and archived. Raw transcript remains available in ${archiveRootMatch[1]}.`
          : 'Earlier conversation history was summarized and archived for longer chats.',
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
