import { describe, expect, it } from 'vitest';
import {
  buildPromptRenderLines,
  resolvePromptInputRenderWidth,
  shouldKeepOptimisticPromptInputState,
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
    expect(resolvePromptInputRenderWidth(12)).toBe(10);
    expect(buildPromptRenderLines('abcdefghijklmnop', 16, 8, resolvePromptInputRenderWidth(12))).toEqual([
      {
        before: 'abcdefgh',
        cursor: '',
        after: '',
        hasCursor: false,
      },
      {
        before: 'ijklmnop',
        cursor: ' ',
        after: '',
        hasCursor: true,
      },
    ]);
  });

  it('keeps newer optimistic input when an older parent echo arrives', () => {
    expect(shouldKeepOptimisticPromptInputState({
      current: { value: 'abc', cursor: 3 },
      incoming: { value: 'ab', cursor: 2 },
      pending: { value: 'abc', cursor: 3 },
    })).toBe(true);
  });

  it('accepts parent state once it catches up with the optimistic input', () => {
    expect(shouldKeepOptimisticPromptInputState({
      current: { value: 'abc', cursor: 3 },
      incoming: { value: 'abc', cursor: 3 },
      pending: { value: 'abc', cursor: 3 },
    })).toBe(false);
  });

  it('accepts external parent updates after optimistic input is cleared', () => {
    expect(shouldKeepOptimisticPromptInputState({
      current: { value: 'abc', cursor: 3 },
      incoming: { value: '', cursor: 0 },
      pending: undefined,
    })).toBe(false);
  });
});
