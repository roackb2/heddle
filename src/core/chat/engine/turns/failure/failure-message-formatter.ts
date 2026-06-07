import type { ConversationTurnFailureHintOptions } from './types.js';

/**
 * Formats model/provider failures with turn-specific recovery hints.
 */
export class ConversationTurnFailureMessages {
  static format(message: string, options: ConversationTurnFailureHintOptions): string {
    if (ConversationTurnFailureMessages.looksLikeContextWindowOverload(message)) {
      const sizeHint =
        typeof options.estimatedHistoryTokens === 'number' ?
          ` Current session history is estimated at about ${options.estimatedHistoryTokens.toLocaleString()} tokens before the next request.`
        : '';
      return `${message}\n\nThis failed because the current prompt plus session history exceeded the model context window.${sizeHint} Heddle will automatically compact earlier history for the next retry.`;
    }

    if (ConversationTurnFailureMessages.looksLikeAnthropicInputRateLimit(message)) {
      const sizeHint =
        typeof options.estimatedHistoryTokens === 'number' ?
          ` Current session history is estimated at about ${options.estimatedHistoryTokens.toLocaleString()} tokens before the next request.`
        : '';
      return `${message}\n\nThis likely failed because the current prompt plus session history are too large for ${options.model}'s input-token-per-minute limit.${sizeHint} Try /compact, /clear, or /session new, then retry.`;
    }

    if (ConversationTurnFailureMessages.looksLikeOpenAiQuotaError(message)) {
      return `${message}\n\nThis looks like an OpenAI quota or billing limit for the active key, not a transient prompt-size issue. Switch providers or check the OpenAI account quota and billing state.`;
    }

    return message;
  }

  static shouldForceCompactionAfterFailure(message: string): boolean {
    return ConversationTurnFailureMessages.looksLikeContextWindowOverload(message);
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

  private static looksLikeOpenAiQuotaError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('exceeded your current quota')
      || (normalized.includes('billing details') && normalized.includes('quota'))
    );
  }
}
