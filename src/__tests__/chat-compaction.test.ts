import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../llm/types.js';
import { compactChatHistory, isCompactedHistorySummary } from '../cli/chat/state/compaction.js';
import { buildConversationMessages } from '../cli/chat/utils/format.js';

describe('chat history compaction', () => {
  it('compacts older transcript messages into a summary and keeps recent messages', () => {
    const history: ChatMessage[] = Array.from({ length: 50 }).flatMap((_, index) => [
      { role: 'user' as const, content: `User prompt ${index}: ${'u'.repeat(4000)}` },
      { role: 'assistant' as const, content: `Assistant reply ${index}: ${'a'.repeat(4000)}` },
    ]);

    const compacted = compactChatHistory({
      history,
      model: 'gpt-4.1',
    });

    expect(isCompactedHistorySummary(compacted.history[0]!)).toBe(true);
    expect(compacted.history.length).toBeLessThan(history.length);
    expect(compacted.history.at(-1)).toEqual(history.at(-1));
    expect(compacted.history.at(-2)).toEqual(history.at(-2));
    expect(compacted.context.estimatedHistoryTokens).toBeLessThan(80_000);
    expect(compacted.context.compactedMessages).toBeGreaterThan(0);

    const visibleMessages = buildConversationMessages(compacted.history);
    expect(visibleMessages[0]?.text).toContain('Earlier conversation history was compacted');
  });
});
