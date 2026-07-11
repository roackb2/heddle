import { describe, expect, it } from 'vitest';
import { ConversationRunService as CuratedConversationRunService } from '../../../index.js';
import { ConversationRunService as HostedConversationRunService } from '../../../hosted.js';
import {
  ConversationRunConsumerService,
  ConversationRunProtocolCodec,
} from '../../../remote.js';
import { z } from 'zod';

describe('public hosting entrypoints', () => {
  it('exposes the existing run coordinator through the explicit hosted subpath', () => {
    expect(HostedConversationRunService).toBe(CuratedConversationRunService);
  });

  it('exposes the browser-safe remote consumer and protocol codec', () => {
    const consumer = new ConversationRunConsumerService();
    const codec = new ConversationRunProtocolCodec({
      activity: z.object({ type: z.string() }),
      result: z.object({ summary: z.string() }),
    });

    expect(consumer.select({ runId: 'run-1' })).toBe(true);
    expect(codec.parseEvent({
      kind: 'result',
      runId: 'run-1',
      sequence: 1,
      timestamp: '2026-07-11T00:00:00.000Z',
      result: { summary: 'Done' },
    })).toMatchObject({ kind: 'result', result: { summary: 'Done' } });
  });
});
