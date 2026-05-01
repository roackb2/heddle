import { describe, expect, it } from 'vitest';
import { insertMentionSelection } from '../../../cli/chat/utils/file-mentions.js';
import { buildPromptRenderLines, insertPromptText } from '../../../cli/chat/components/PromptInput.js';

describe('prompt input related helpers', () => {
  it('places the inserted mention at the end of the current trailing mention token', () => {
    const nextDraft = insertMentionSelection('take a look at @REA', 'README.md');
    expect(nextDraft).toBe('take a look at @README.md');
    expect(nextDraft.length).toBe('take a look at @README.md'.length);
  });

  it('preserves rapid sequential input when applying draft transitions immediately', () => {
    const afterA = insertPromptText({ value: '', cursor: 0 }, 'a');
    const afterB = insertPromptText(afterA, 'b');
    const afterC = insertPromptText(afterB, 'c');

    expect(afterC).toEqual({ value: 'abc', cursor: 3 });
  });

  it('renders the cursor at the end of the line after the last typed character', () => {
    expect(buildPromptRenderLines('asdf', 4, 8, 80)).toEqual([
      {
        before: 'asdf',
        cursor: ' ',
        after: '',
        hasCursor: true,
      },
    ]);
  });

  it('renders the cursor at the current insertion point within a line', () => {
    expect(buildPromptRenderLines('asdf', 2, 8, 80)).toEqual([
      {
        before: 'as',
        cursor: 'd',
        after: 'f',
        hasCursor: true,
      },
    ]);
  });

  it('places a wrapped-line boundary cursor at the start of the next visual segment', () => {
    expect(buildPromptRenderLines('abcd', 2, 8, 2)).toEqual([
      {
        before: 'ab',
        cursor: '',
        after: '',
        hasCursor: false,
      },
      {
        before: '',
        cursor: 'c',
        after: 'd',
        hasCursor: true,
      },
    ]);
  });

  it('renders an empty line cursor as a highlighted blank cell', () => {
    expect(buildPromptRenderLines('', 0, 8, 80)).toEqual([
      {
        before: '',
        cursor: ' ',
        after: '',
        hasCursor: true,
      },
    ]);
  });
});
