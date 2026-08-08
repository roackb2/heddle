import { describe, expect, it } from 'vitest';
import { ConversationTurnFailureMessages } from '@/core/chat/engine/turns/failure/index.js';

describe('ConversationTurnFailureMessages', () => {
  it('adds automatic compaction guidance for context-window overloads', () => {
    const message = 'Your input exceeds the context window of this model. Please adjust your input and try again.';
    const formatted = ConversationTurnFailureMessages.format(
      message,
      { model: 'gpt-5.5', estimatedHistoryTokens: 201163 },
    );

    expect(formatted).toContain('exceeded the model context window');
    expect(formatted).toContain('201,163 tokens');
    expect(formatted).toContain('bounded same-turn compaction retry');
    expect(formatted).toContain('compacted when possible for a later retry');
    expect(ConversationTurnFailureMessages.shouldForceCompactionAfterFailure(message)).toBe(true);
  });

  it('uses the structured context-window failure when provider text is sanitized', () => {
    const failure = { source: 'model' as const, code: 'context_window' as const };
    const message = 'LLM error: Model context window was exceeded';
    const formatted = ConversationTurnFailureMessages.format(message, {
      model: 'gpt-5.6-sol',
      failure,
    });

    expect(formatted).toContain('bounded same-turn compaction retry');
    expect(ConversationTurnFailureMessages.shouldForceCompactionAfterFailure(message, failure)).toBe(true);
  });

  it('adds manual compaction guidance for likely input-size TPM failures', () => {
    const formatted = ConversationTurnFailureMessages.format(
      `429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your organization's rate limit of 30,000 input tokens per minute. Please reduce the prompt length or the maximum tokens requested."}}`,
      { model: 'claude-sonnet-4-6', estimatedHistoryTokens: 18234 },
    );

    expect(formatted).toContain('input-token-per-minute limit');
    expect(formatted).toContain('18,234 tokens');
    expect(formatted).toContain('/compact, /clear, or /session new');
    expect(ConversationTurnFailureMessages.shouldForceCompactionAfterFailure(formatted)).toBe(false);
  });

  it('adds quota recovery guidance from the structured run failure', () => {
    const formatted = ConversationTurnFailureMessages.format(
      'LLM error: Model provider quota or billing limit reached',
      { model: 'gpt-5.4', failure: { source: 'model', code: 'quota' } },
    );

    expect(formatted).toContain('no usable provider quota or billing capacity');
    expect(formatted).toContain('switch credentials or providers');
  });

  it('does not infer quota recovery guidance from provider message text', () => {
    const message = 'You exceeded your current quota, please check your plan and billing details.';

    expect(ConversationTurnFailureMessages.format(message, { model: 'gpt-5.4' })).toBe(message);
  });
});
