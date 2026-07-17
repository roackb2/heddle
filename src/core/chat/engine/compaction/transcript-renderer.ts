import type { ChatMessage } from '@/core/llm/types.js';
import { ModelCatalogService } from '@/core/llm/models/index.js';
import {
  DEFAULT_CONTEXT_WINDOW_ESTIMATE,
  MAX_SUMMARIZER_CONTEXT_RATIO,
  MAX_SUMMARIZER_MESSAGE_CHARS,
  MAX_SUMMARIZER_TRANSCRIPT_CHARS,
  MAX_SUMMARIZER_TRANSCRIPT_TOKENS,
  MIN_SUMMARIZER_MESSAGE_CHARS,
} from './constants.js';
import { CompactionText } from './text.js';

/**
 * Renders archived messages into a bounded prompt payload for the summarizer.
 */
export class CompactionTranscriptRenderer {
  static render(messages: ChatMessage[], summaryModel: string): string {
    if (messages.length === 0) {
      return '(no archived messages)';
    }

    const transcriptCharBudget = CompactionTranscriptRenderer.resolveTranscriptCharBudget(summaryModel);
    const perMessageBudget = Math.max(
      MIN_SUMMARIZER_MESSAGE_CHARS,
      Math.min(MAX_SUMMARIZER_MESSAGE_CHARS, Math.floor(transcriptCharBudget / messages.length) - 80),
    );
    const lines: string[] = [
      `Summarizer transcript note: raw archive contains ${messages.length} complete messages.`,
      'Each message below is condensed to fit the summarizer request. After a successful compaction, use the configured repository retrieval capability when exact wording or full tool output matters.',
      `Summarizer input budget: about ${Math.floor(transcriptCharBudget / 4).toLocaleString()} estimated text tokens.`,
    ];
    let totalChars = lines.join('\n').length;

    for (const [index, message] of messages.entries()) {
      const rendered = `## Message ${index + 1}\n${CompactionTranscriptRenderer.renderMessage(message, perMessageBudget)}`;
      const separator = lines.length > 0 ? '\n\n' : '';
      if (totalChars + separator.length + rendered.length > transcriptCharBudget) {
        lines.push(`\n\nOmitted ${messages.length - index} additional archived messages from summarizer input to stay within request budget. Retrieve the raw archive through the configured repository for full detail.`);
        break;
      }

      lines.push(rendered);
      totalChars += separator.length + rendered.length;
    }

    return lines.join('\n\n');
  }

  private static resolveTranscriptCharBudget(summaryModel: string): number {
    const contextWindow = ModelCatalogService.estimateBuiltInContextWindow(summaryModel) ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE;
    const budgetByContext = Math.floor(contextWindow * MAX_SUMMARIZER_CONTEXT_RATIO);
    const tokenBudget = Math.min(MAX_SUMMARIZER_TRANSCRIPT_TOKENS, budgetByContext);
    return Math.min(MAX_SUMMARIZER_TRANSCRIPT_CHARS, tokenBudget * 4);
  }

  private static renderMessage(message: ChatMessage, maxChars: number): string {
    if (message.role === 'assistant') {
      const parts = [
        'Role: assistant',
        message.content ? `Content excerpt:\n${CompactionText.truncateForSummary(message.content, maxChars)}` : 'Content: (empty)',
        message.toolCalls?.length ?
          `Tool calls:\n${CompactionText.truncateForSummary(JSON.stringify(message.toolCalls, null, 2), maxChars)}`
        : undefined,
      ].filter((part): part is string => Boolean(part));
      return parts.join('\n\n');
    }

    if (message.role === 'tool') {
      return [
        'Role: tool',
        `Tool call id: ${message.toolCallId}`,
        `Content excerpt:\n${CompactionText.truncateForSummary(message.content, maxChars)}`,
      ].join('\n\n');
    }

    return [
      `Role: ${message.role}`,
      `Content excerpt:\n${CompactionText.truncateForSummary(message.content, maxChars)}`,
    ].join('\n\n');
  }
}
