/**
 * Pure projection from persisted model transcript to visible conversation lines.
 *
 * Keep transcript-to-UI-message semantics here. This class should not know
 * about storage, host state, or session lifecycle policy.
 */
import type { ChatMessage } from '@/core/llm/types.js';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import type { ConversationLine } from '@/core/chat/types.js';

export class ConversationLines {
  static fromHistory(history: ChatMessage[]): ConversationLine[] {
    return history.flatMap((message, index) => {
      if (ConversationCompactionService.isCompactedHistorySummary(message)) {
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
}
