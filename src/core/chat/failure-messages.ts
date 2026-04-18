export type ChatFailureHintOptions = {
  model: string;
  estimatedHistoryTokens?: number;
};

export function formatChatFailureMessage(message: string, options: ChatFailureHintOptions): string {
  if (looksLikeAnthropicInputRateLimit(message)) {
    const sizeHint =
      typeof options.estimatedHistoryTokens === 'number' ?
        ` Current session history is estimated at about ${options.estimatedHistoryTokens.toLocaleString()} tokens before the next request.`
      : '';
    return `${message}\n\nThis likely failed because the current prompt plus session history are too large for ${options.model}'s input-token-per-minute limit.${sizeHint} Try /compact, /clear, or /session new, then retry.`;
  }

  if (looksLikeOpenAiQuotaError(message)) {
    return `${message}\n\nThis looks like an OpenAI quota or billing limit for the active key, not a transient prompt-size issue. Switch providers or check the OpenAI account quota and billing state.`;
  }

  return message;
}

function looksLikeAnthropicInputRateLimit(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('input tokens per minute')
    || (normalized.includes('reduce the prompt length') && normalized.includes('maximum tokens requested'))
    || (normalized.includes('rate_limit_error') && normalized.includes('tokens per minute'))
  );
}

function looksLikeOpenAiQuotaError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('exceeded your current quota')
    || (normalized.includes('billing details') && normalized.includes('quota'))
  );
}
