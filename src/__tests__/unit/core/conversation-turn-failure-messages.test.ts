import { describe, expect, it } from 'vitest';
import { ConversationTurnFailureMessages } from '@/core/chat/engine/turns/failure/index.js';

describe('ConversationTurnFailureMessages', () => {
  it('adds manual compaction guidance for likely input-size TPM failures', () => {
    const formatted = ConversationTurnFailureMessages.format(
      `429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your organization's rate limit of 30,000 input tokens per minute. Please reduce the prompt length or the maximum tokens requested."}}`,
      { model: 'claude-sonnet-4-6', estimatedHistoryTokens: 18234 },
    );

    expect(formatted).toContain('input-token-per-minute limit');
    expect(formatted).toContain('18,234 tokens');
    expect(formatted).toContain('/compact, /clear, or /session new');
  });

  it('distinguishes OpenAI quota exhaustion from prompt-size issues', () => {
    const formatted = ConversationTurnFailureMessages.format(
      'You exceeded your current quota, please check your plan and billing details.',
      { model: 'gpt-5.4' },
    );

    expect(formatted).toContain('quota or billing limit');
    expect(formatted).toContain('not a transient prompt-size issue');
  });
});
