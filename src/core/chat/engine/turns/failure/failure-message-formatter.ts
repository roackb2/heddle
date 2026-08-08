import type { ConversationTurnFailureHintOptions } from './types.js';

/**
 * Formats model/provider failures with turn-specific recovery hints.
 */
export class ConversationTurnFailureMessages {
  static format(message: string, options: ConversationTurnFailureHintOptions): string {
    if (options.failure?.source === 'model' && options.failure.code === 'quota') {
      return `${message}\n\nThe active model account or credential has no usable provider quota or billing capacity. Check the provider account or switch credentials or providers before retrying.`;
    }

    if (ConversationTurnFailureMessages.isContextWindowFailure(message, options.failure)) {
      const sizeHint =
        typeof options.estimatedHistoryTokens === 'number' ?
          ` Current session history is estimated at about ${options.estimatedHistoryTokens.toLocaleString()} tokens before the next request.`
        : '';
      return `${message}\n\nThis failed because the current prompt plus session history exceeded the model context window.${sizeHint} Heddle's bounded same-turn compaction retry was unavailable or still exceeded the window. Earlier history was compacted when possible for a later retry.`;
    }

    if (ConversationTurnFailureMessages.looksLikeAnthropicInputRateLimit(message)) {
      const sizeHint =
        typeof options.estimatedHistoryTokens === 'number' ?
          ` Current session history is estimated at about ${options.estimatedHistoryTokens.toLocaleString()} tokens before the next request.`
        : '';
      return `${message}\n\nThis likely failed because the current prompt plus session history are too large for ${options.model}'s input-token-per-minute limit.${sizeHint} Try /compact, /clear, or /session new, then retry.`;
    }

    return message;
  }

  static shouldForceCompactionAfterFailure(message: string, failure?: ConversationTurnFailureHintOptions['failure']): boolean {
    return ConversationTurnFailureMessages.isContextWindowFailure(message, failure);
  }

  private static isContextWindowFailure(
    message: string,
    failure?: ConversationTurnFailureHintOptions['failure'],
  ): boolean {
    return (failure?.source === 'model' && failure.code === 'context_window')
      || ConversationTurnFailureMessages.looksLikeContextWindowOverload(message);
  }

  private static looksLikeContextWindowOverload(message: string): boolean {
    const normalized = message.toLowerCase();
    return [
      'exceeds the context window',
      'exceeded the context window',
      'context window exceeded',
      'context length exceeded',
      'maximum context length',
      'prompt is too long',
      'input is too long',
    ].some((phrase) => normalized.includes(phrase));
  }

  private static looksLikeAnthropicInputRateLimit(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('input tokens per minute')
      || (normalized.includes('reduce the prompt length') && normalized.includes('maximum tokens requested'))
      || (normalized.includes('rate_limit_error') && normalized.includes('tokens per minute'))
    );
  }
}
