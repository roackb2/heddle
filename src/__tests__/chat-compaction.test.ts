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

  it('can force a single manual compaction pass even before the auto threshold is exceeded', () => {
    const history: ChatMessage[] = Array.from({ length: 6 }).flatMap((_, index) => [
      { role: 'user' as const, content: `User prompt ${index}: ${'u'.repeat(60)}` },
      { role: 'assistant' as const, content: `Assistant reply ${index}: ${'a'.repeat(60)}` },
    ]);

    const autoCompacted = compactChatHistory({
      history,
      model: 'gpt-5.1',
    });
    const manuallyCompacted = compactChatHistory({
      history,
      model: 'gpt-5.1',
      force: true,
    });

    expect(autoCompacted.history).toEqual(history);
    expect(isCompactedHistorySummary(manuallyCompacted.history[0]!)).toBe(true);
    expect(manuallyCompacted.history.length).toBeLessThan(history.length);
    expect(manuallyCompacted.context.compactedMessages).toBeGreaterThan(0);
  });

  it('can re-compact an already compacted short session when forced manually', () => {
    const history: ChatMessage[] = [
      {
        role: 'system',
        content: 'Heddle compacted earlier conversation history.\n\nMore recent archived turns:\nAssistant: Earlier summary.',
      },
      { role: 'system', content: 'Host reminder: use the evidence you already gathered.' },
      { role: 'tool', toolCallId: 'tool-1', content: '{"ok":true,"output":"git diff --stat HEAD"}' },
      { role: 'user', content: 'can you try again' },
      { role: 'user', content: 'try again' },
    ];

    const compacted = compactChatHistory({
      history,
      model: 'gpt-5.1',
      force: true,
    });

    expect(compacted.history.length).toBeLessThan(history.length);
    expect(isCompactedHistorySummary(compacted.history[0]!)).toBe(true);
    expect(compacted.context.compactedMessages).toBeGreaterThan(0);
  });
});
