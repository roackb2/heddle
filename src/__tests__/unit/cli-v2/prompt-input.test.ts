import { describe, expect, it } from 'vitest';
import {
  buildPromptRenderLines,
  resolvePromptInputRenderWidth,
} from '@/cli-v2/components/PromptInput.js';

describe('cli-v2 PromptInput helpers', () => {
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

  it('places a wrapped-line boundary cursor at the start of the next visual segment', () => {
    expect(buildPromptRenderLines('abcd', 2, 8, 4)).toEqual([
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

  it('reserves prompt-prefix width when wrapping long input in narrow terminals', () => {
    expect(buildPromptRenderLines('abcdef', 6, 8, 5)).toEqual([
      {
        before: 'abc',
        cursor: '',
        after: '',
        hasCursor: false,
      },
      {
        before: 'def',
        cursor: ' ',
        after: '',
        hasCursor: true,
      },
    ]);
  });

  it('prefers explicit parent width over the fallback render width', () => {
    expect(resolvePromptInputRenderWidth(12)).toBe(12);
    expect(buildPromptRenderLines('abcdefghijklmnop', 16, 8, resolvePromptInputRenderWidth(12))).toEqual([
      {
        before: 'abcdefghij',
        cursor: '',
        after: '',
        hasCursor: false,
      },
      {
        before: 'klmnop',
        cursor: ' ',
        after: '',
        hasCursor: true,
      },
    ]);
  });
});
