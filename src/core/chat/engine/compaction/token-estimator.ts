import type { ChatMessage } from '@/core/llm/types.js';
import { COMPACTED_HISTORY_MARKER } from './constants.js';
import type { ConversationCompactionContextInput } from './types.js';

/**
 * Owns low-cost token estimates used by compaction thresholds and context stats.
 */
export class ConversationCompactionTokenEstimator {
  static estimateHistory(history: ChatMessage[]): number {
    return history.reduce((total, message) => total + ConversationCompactionTokenEstimator.estimateMessage(message), 0);
  }

  static estimateRequest(input: Pick<ConversationCompactionContextInput, 'history' | 'runtime' | 'request'>): number {
    const syntheticGoal = input.request?.goal ?? 'Continue from the current conversation.';
    const systemPromptEstimate = ConversationCompactionTokenEstimator.estimateText([
      syntheticGoal,
      input.runtime.systemContext ?? '',
      input.request?.toolNames?.join(',') ?? '',
    ].join('\n'));
    return systemPromptEstimate + ConversationCompactionTokenEstimator.estimateHistory(input.history) + ConversationCompactionTokenEstimator.estimateText(syntheticGoal) + 24;
  }

  static isCompactedSummary(message: ChatMessage): boolean {
    return message.role === 'system' && message.content.startsWith(COMPACTED_HISTORY_MARKER);
  }

  static countNonCompactedMessages(history: ChatMessage[]): number {
    return history.filter((message) => !ConversationCompactionTokenEstimator.isCompactedSummary(message)).length;
  }

  static estimateMessage(message: ChatMessage): number {
    if (ConversationCompactionTokenEstimator.isCompactedSummary(message)) {
      return ConversationCompactionTokenEstimator.estimateText(message.content) + 12;
    }

    switch (message.role) {
      case 'system':
      case 'user':
      case 'tool':
        return ConversationCompactionTokenEstimator.estimateText(message.content) + 12;
      case 'assistant':
        return ConversationCompactionTokenEstimator.estimateText(message.content) + 12 + (message.toolCalls?.length ?? 0) * 24;
    }
  }

  static estimateText(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
