import { describe, expect, it } from 'vitest';
import { insertMentionSelection } from '../cli/chat/utils/file-mentions.js';

describe('prompt input related helpers', () => {
  it('places the inserted mention at the end of the current trailing mention token', () => {
    const nextDraft = insertMentionSelection('take a look at @REA', 'README.md');
    expect(nextDraft).toBe('take a look at @README.md');
    expect(nextDraft.length).toBe('take a look at @README.md'.length);
  });
});
