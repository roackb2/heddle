import type { ChatMessage } from '@/core/llm/types.js';
import {
  MAX_RECENT_HISTORY_TOKEN_BUDGET,
  MIN_RECENT_HISTORY_TOKEN_BUDGET,
} from './constants.js';
import { ConversationCompactionTokenEstimator } from './token-estimator.js';

/**
 * Chooses the archive/recent boundary without splitting tool-call pairs.
 */
export class ConversationCompactionSplitPolicy {
  static resolveRecentHistoryTokenBudget(contextWindow: number, ratio: number): number {
    return Math.max(
      MIN_RECENT_HISTORY_TOKEN_BUDGET,
      Math.min(MAX_RECENT_HISTORY_TOKEN_BUDGET, Math.floor(contextWindow * ratio)),
    );
  }

  static findSplit(history: ChatMessage[], options: {
    recentTokenBudget: number;
    preferredRecentMessages: number;
    stopAtPreferredMessages?: boolean;
  }): number {
    let splitIndex = history.length;
    let recentTokens = 0;
    let recentMessages = 0;

    while (splitIndex > 0) {
      if (options.stopAtPreferredMessages && recentMessages >= options.preferredRecentMessages) {
        break;
      }

      const nextMessage = history[splitIndex - 1];
      if (!nextMessage) {
        break;
      }

      const nextTokens = ConversationCompactionTokenEstimator.estimateMessage(nextMessage);
      const exceedsBudget = recentTokens + nextTokens > options.recentTokenBudget;
      const reachedPreferredCount = recentMessages >= options.preferredRecentMessages;
      if (recentMessages > 0 && exceedsBudget && reachedPreferredCount) {
        break;
      }
      if (recentMessages > 0 && exceedsBudget && nextTokens > options.recentTokenBudget) {
        break;
      }

      splitIndex--;
      recentTokens += nextTokens;
      if (!ConversationCompactionTokenEstimator.isCompactedSummary(nextMessage)) {
        recentMessages++;
      }

      if (recentMessages >= options.preferredRecentMessages && recentTokens >= options.recentTokenBudget) {
        break;
      }
    }

    while (splitIndex > 0 && history[splitIndex]?.role === 'tool') {
      splitIndex--;
    }

    if (splitIndex > 0 && ConversationCompactionSplitPolicy.isAssistantToolCallMessage(history[splitIndex - 1])) {
      splitIndex--;
    }

    return splitIndex;
  }

  private static isAssistantToolCallMessage(
    message: ChatMessage | undefined,
  ): message is Extract<ChatMessage, { role: 'assistant'; toolCalls?: unknown }> & { toolCalls: NonNullable<Extract<ChatMessage, { role: 'assistant' }>['toolCalls']> } {
    return message?.role === 'assistant' && !!message.toolCalls && message.toolCalls.length > 0;
  }
}
