import { describe, expect, it } from 'vitest';
import { ConversationRunService as CuratedConversationRunService } from '../../../index.js';
import { ConversationRunService as HostedConversationRunService } from '../../../hosted.js';

describe('public hosting entrypoints', () => {
  it('exposes the existing run coordinator through the explicit hosted subpath', () => {
    expect(HostedConversationRunService).toBe(CuratedConversationRunService);
  });
});
