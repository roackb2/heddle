import { describe, expect, it } from 'vitest';
import { insertMentionSelection } from '../../../cli/chat/utils/file-mentions.js';
import { parseInlineSegments, parseMessageBlocks } from '../../../cli/chat/components/ConversationPanel.js';
import {
  buildPromptRenderLines,
  canNavigatePromptHistory,
  insertPromptText,
  resolvePromptHistoryNavigation,
  resolvePromptInputRenderWidth,
  resolvePromptRedo,
  resolvePromptUndo,
} from '../../../cli/chat/components/PromptInput.js';

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

  it('resolves undo and redo draft states', () => {
    const undo = resolvePromptUndo(
      [{ value: '', cursor: 0 }, { value: 'hello', cursor: 5 }],
      [],
      { value: 'hello!', cursor: 6 },
    );

    expect(undo).toEqual({
      state: { value: 'hello', cursor: 5 },
      undoStack: [{ value: '', cursor: 0 }],
      redoStack: [{ value: 'hello!', cursor: 6 }],
    });

    expect(resolvePromptRedo(
      undo?.undoStack ?? [],
      undo?.redoStack ?? [],
      undo?.state ?? { value: '', cursor: 0 },
    )).toEqual({
      state: { value: 'hello!', cursor: 6 },
      undoStack: [{ value: '', cursor: 0 }, { value: 'hello', cursor: 5 }],
      redoStack: [],
    });
  });

  it('navigates prompt history while preserving the in-progress draft', () => {
    const history = ['first prompt', 'second prompt'];
    const current = { value: 'draft in progress', cursor: 5 };
    const previous = resolvePromptHistoryNavigation({
      direction: 'previous',
      history,
      current,
    });

    expect(previous).toEqual({
      state: { value: 'second prompt', cursor: 'second prompt'.length },
      historyIndex: 1,
      savedDraftBeforeHistory: current,
    });

    expect(resolvePromptHistoryNavigation({
      direction: 'previous',
      history,
      current: previous?.state ?? current,
      historyIndex: previous?.historyIndex,
      savedDraftBeforeHistory: previous?.savedDraftBeforeHistory,
    })).toEqual({
      state: { value: 'first prompt', cursor: 'first prompt'.length },
      historyIndex: 0,
      savedDraftBeforeHistory: current,
    });

    expect(resolvePromptHistoryNavigation({
      direction: 'next',
      history,
      current: previous?.state ?? current,
      historyIndex: previous?.historyIndex,
      savedDraftBeforeHistory: previous?.savedDraftBeforeHistory,
    })).toEqual({
      state: current,
      historyIndex: undefined,
      savedDraftBeforeHistory: undefined,
    });
  });

  it('only uses up/down for multiline history navigation at first or last logical line', () => {
    const value = 'first\nsecond\nthird';

    expect(canNavigatePromptHistory('previous', { value, cursor: 2 })).toBe(true);
    expect(canNavigatePromptHistory('previous', { value, cursor: 8 })).toBe(false);
    expect(canNavigatePromptHistory('next', { value, cursor: 8 })).toBe(false);
    expect(canNavigatePromptHistory('next', { value, cursor: value.length })).toBe(true);
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

  it('prefers explicit parent width over stdout width for prompt wrapping', () => {
    expect(resolvePromptInputRenderWidth(12, 120)).toBe(12);
    expect(buildPromptRenderLines('abcdefghijklmnop', 16, 8, resolvePromptInputRenderWidth(12, 120))).toEqual([
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

  it('does not hang while rendering unmatched inline markdown markers from regex-heavy prompts', () => {
    const prompt = [
      'Please review this follow-up without crashing.',
      '',
      '```sh',
      "rg -n 'callbackFanout|old/path|useAgentRun\\(' src/cli/chat",
      "rg -n \"match\\(/|replace\\(/^[-*]\\\\s+/\" src/cli/chat/components/ConversationPanel.tsx",
      '```',
      '',
      'Also inspect literal backticks like `unterminated and bold markers like **missing close.',
      'Shell-ish examples: foo && bar || baz; echo "quotes"; printf \'\\\\n\'; (cd src && rg "x")',
    ].join('\n');

    expect(parseInlineSegments('literal `unterminated marker')).toEqual([
      { kind: 'text', text: 'literal ' },
      { kind: 'text', text: '`' },
      { kind: 'text', text: 'unterminated marker' },
    ]);
    expect(parseInlineSegments('literal **unterminated marker')).toEqual([
      { kind: 'text', text: 'literal ' },
      { kind: 'text', text: '**' },
      { kind: 'text', text: 'unterminated marker' },
    ]);
    expect(buildPromptRenderLines(prompt, prompt.length, 10, 80).at(-1)).toMatchObject({
      hasCursor: true,
    });
  });

  it('parses mixed block content with code fences using the refactored block parser', () => {
    expect(parseMessageBlocks([
      '# Heading',
      '',
      'alpha',
      'beta',
      '- [x] done',
      '- bullet',
      '1. first',
      '> quoted',
      '```ts',
      'const x = 1;',
      '```',
    ].join('\n'))).toEqual([
      { kind: 'heading', text: 'Heading' },
      { kind: 'blank', text: '' },
      { kind: 'paragraph', text: 'alpha beta' },
      { kind: 'task', marker: '[x]', text: 'done' },
      { kind: 'bullet', text: 'bullet' },
      { kind: 'numbered', marker: '1.', text: 'first' },
      { kind: 'quote', text: 'quoted' },
      { kind: 'code', info: 'ts', text: 'const x = 1;' },
    ]);
  });
});
