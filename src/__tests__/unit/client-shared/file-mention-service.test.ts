import { describe, expect, it } from 'vitest';
import { ClientSharedFileMentionService } from '@/client-shared/services/file-mentions/index.js';

describe('ClientSharedFileMentionService', () => {
  it('detects active mention tokens without matching email addresses', () => {
    expect(ClientSharedFileMentionService.findToken('Compare @REA', 12)).toEqual({
      query: 'REA',
      start: 8,
      end: 12,
    });
    expect(ClientSharedFileMentionService.findToken('test@example.com', 16)).toBeNull();
  });

  it('inserts a selected file mention at the active token', () => {
    expect(ClientSharedFileMentionService.insertSelection(
      'Compare @REA',
      { query: 'REA', start: 8, end: 12 },
      'README.md',
    )).toEqual({
      value: 'Compare @README.md ',
      cursor: 19,
    });
  });
});
