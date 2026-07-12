import { describe, expect, it } from 'vitest';
import {
  ConversationRunSseReplayCursorError,
  parseConversationRunSseReplayCursor,
} from '@/core/chat/runs/http-sse/index.js';

describe('conversation run HTTP/SSE server helpers', () => {
  it('uses an explicit query cursor before Last-Event-ID', () => {
    expect(parseConversationRunSseReplayCursor({
      query: '0',
      lastEventId: '12',
    })).toBe(0);
    expect(parseConversationRunSseReplayCursor({ lastEventId: '12' })).toBe(12);
    expect(parseConversationRunSseReplayCursor({})).toBeUndefined();
  });

  it.each(['', '-1', '01', '1.5', '9007199254740992', ['1']])(
    'rejects malformed replay cursor %j',
    (value) => {
      expect(() => parseConversationRunSseReplayCursor({ query: value }))
        .toThrow(ConversationRunSseReplayCursorError);
    },
  );
});
