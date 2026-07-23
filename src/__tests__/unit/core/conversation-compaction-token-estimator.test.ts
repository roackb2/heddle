import { describe, expect, it } from 'vitest';
import { ConversationCompactionTokenEstimator } from '@/core/chat/engine/compaction/token-estimator.js';

describe('ConversationCompactionTokenEstimator', () => {
  it('counts provider-private continuation retained in model context', () => {
    const withoutContinuation = ConversationCompactionTokenEstimator.estimateMessage({
      role: 'assistant',
      content: 'Done.',
    });
    const withContinuation = ConversationCompactionTokenEstimator.estimateMessage({
      role: 'assistant',
      content: 'Done.',
      providerContinuation: {
        provider: 'kimi',
        reasoningContent: '12345678',
      },
    });

    expect(withContinuation - withoutContinuation).toBe(2);
  });
});
