import { describe, expect, it } from 'vitest';
import { ClientSharedPromptInputService } from '@/client-shared/services/prompt-input/index.js';

describe('ClientSharedPromptInputService', () => {
  it('edits text around the cursor', () => {
    expect(ClientSharedPromptInputService.insertText({ value: 'helo', cursor: 2 }, 'l')).toEqual({
      value: 'hello',
      cursor: 3,
    });
    expect(ClientSharedPromptInputService.deletePreviousWord({ value: 'hello world', cursor: 11 })).toEqual({
      value: 'hello ',
      cursor: 6,
    });
    expect(ClientSharedPromptInputService.deleteBeforeCursor({ value: 'hello world', cursor: 6 })).toEqual({
      value: 'world',
      cursor: 0,
    });
  });

  it('navigates prompt history while preserving an in-progress draft', () => {
    const history = ClientSharedPromptInputService.recordPrompt(
      ClientSharedPromptInputService.recordPrompt({ entries: [] }, 'first prompt'),
      'second prompt',
    );
    const currentDraft = { value: 'draft in progress', cursor: 5 };
    const previous = ClientSharedPromptInputService.navigateHistory({
      state: history,
      currentDraft,
      direction: 'previous',
    });

    expect(previous).toEqual({
      history: {
        entries: ['first prompt', 'second prompt'],
        index: 1,
        savedDraft: currentDraft,
      },
      draft: { value: 'second prompt', cursor: 'second prompt'.length },
    });

    expect(ClientSharedPromptInputService.navigateHistory({
      state: previous?.history ?? history,
      currentDraft: previous?.draft ?? currentDraft,
      direction: 'next',
    })).toEqual({
      history: {
        entries: ['first prompt', 'second prompt'],
        index: undefined,
        savedDraft: undefined,
      },
      draft: currentDraft,
    });
  });

  it('limits multiline history navigation to the first and last logical lines', () => {
    const value = 'first\nsecond\nthird';

    expect(ClientSharedPromptInputService.canNavigateHistory('previous', { value, cursor: 2 })).toBe(true);
    expect(ClientSharedPromptInputService.canNavigateHistory('previous', { value, cursor: 8 })).toBe(false);
    expect(ClientSharedPromptInputService.canNavigateHistory('next', { value, cursor: 8 })).toBe(false);
    expect(ClientSharedPromptInputService.canNavigateHistory('next', { value, cursor: value.length })).toBe(true);
  });

  it('preserves internal line breaks in submitted prompt history', () => {
    const prompt = 'First step\nSecond step';
    const history = ClientSharedPromptInputService.recordPrompt({ entries: [] }, `  ${prompt}  `);

    expect(history.entries).toEqual([prompt]);
    expect(ClientSharedPromptInputService.navigateHistory({
      state: history,
      currentDraft: { value: '', cursor: 0 },
      direction: 'previous',
    })?.draft).toEqual({ value: prompt, cursor: prompt.length });
  });

  it('tracks prompt undo and redo stacks without recording no-op edits', () => {
    const initial = { value: 'hello', cursor: 5 };
    const edited = { value: 'hello!', cursor: 6 };
    const history = ClientSharedPromptInputService.recordUndoState(
      ClientSharedPromptInputService.clearUndoRedo(),
      initial,
      edited,
    );

    expect(ClientSharedPromptInputService.recordUndoState(history, edited, edited)).toBe(history);

    const undo = ClientSharedPromptInputService.undoPromptEdit(history, edited);
    expect(undo).toEqual({
      history: {
        undoStack: [],
        redoStack: [edited],
      },
      draft: initial,
    });

    expect(ClientSharedPromptInputService.redoPromptEdit(undo?.history ?? history, initial)).toEqual({
      history: {
        undoStack: [initial],
        redoStack: [],
      },
      draft: edited,
    });
  });

  it('parses direct shell drafts without treating them as normal prompts', () => {
    expect(ClientSharedPromptInputService.parseDirectShellDraft(' ! git status ')).toEqual({
      command: 'git status',
    });
    expect(ClientSharedPromptInputService.parseDirectShellDraft('!')).toEqual({
      command: '',
    });
    expect(ClientSharedPromptInputService.parseDirectShellDraft('ask normally')).toBeUndefined();
  });

  it('normalizes whitespace only for inline command routing', () => {
    expect(ClientSharedPromptInputService.normalizeInlineCommandDraft('  /model\n  gpt-5.4  ')).toBe('/model gpt-5.4');
  });
});
