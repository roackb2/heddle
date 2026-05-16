import type { ChatArchiveRecord } from '@/core/chat/types.js';
import { FileChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import type { ChatMessage } from '@/core/llm/types.js';
import { COMPACTED_HISTORY_MARKER } from './constants.js';
import { CompactionText } from './text.js';
import { ConversationCompactionTokenEstimator } from './token-estimator.js';

/**
 * Builds and detects the compacted-history marker message placed back into active chat history.
 *
 * This is not the LLM summarizer. It only shapes the synthetic system message
 * that points future turns at the rolling summary and archive files.
 */
export class ConversationCompactionSummaryMessage {
  static isSummary(message: ChatMessage): boolean {
    return ConversationCompactionTokenEstimator.isCompactedSummary(message);
  }

  static extractPriorSummary(history: ChatMessage[]): string | undefined {
    const summaryMessage = history.find(ConversationCompactionSummaryMessage.isSummary);
    if (!summaryMessage || summaryMessage.role !== 'system') {
      return undefined;
    }

    const content = summaryMessage.content.slice(COMPACTED_HISTORY_MARKER.length).trim();
    return content || undefined;
  }

  static buildArchivedSummaryMessage(options: {
    sessionId: string;
    rollingSummary: string;
    archives: ChatArchiveRecord[];
  }): ChatMessage {
    const archivePaths = options.archives
      .slice(-8)
      .map((archive) => `- ${archive.path}: ${archive.shortDescription ?? `${archive.messageCount} messages archived`}`);

    const content = [
      COMPACTED_HISTORY_MARKER,
      '',
      `Archive root: ${FileChatArchiveRepository.derivePaths('.', options.sessionId).displayArchivesDir}`,
      '',
      'Current rolling summary:',
      CompactionText.truncateSummary(options.rollingSummary),
      '',
      'Archive index:',
      ...(archivePaths.length > 0 ? archivePaths : ['- No archive records found.']),
      '',
      'If exact wording, tool output, or earlier rationale matters, inspect the archive files with normal file tools before relying on this summary.',
    ].join('\n');

    return {
      role: 'system',
      content,
    };
  }
}
