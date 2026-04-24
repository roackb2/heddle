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
      return [];
    }

    return [];
  });
}
