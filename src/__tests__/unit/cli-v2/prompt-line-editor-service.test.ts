import { describe, expect, it } from 'vitest';
import { CliV2PromptLineEditorService } from '../../../cli-v2/services/prompt-input/index.js';

describe('CliV2PromptLineEditorService', () => {
  it('maps terminal editing shortcuts to prompt commands', () => {
    expect(CliV2PromptLineEditorService.resolveCommand('', { meta: true, backspace: true })).toEqual({
      kind: 'deletePreviousWord',
    });
    expect(CliV2PromptLineEditorService.resolveCommand('', { super: true, backspace: true })).toEqual({
      kind: 'deleteBeforeCursor',
    });
    expect(CliV2PromptLineEditorService.resolveCommand('', { meta: true, leftArrow: true })).toEqual({
      kind: 'move',
      direction: 'previousWord',
    });
    expect(CliV2PromptLineEditorService.resolveCommand('', { super: true, rightArrow: true })).toEqual({
      kind: 'move',
      direction: 'end',
    });
  });

  it('applies cursor-aware editing commands', () => {
    expect(CliV2PromptLineEditorService.applyCommand(
      { kind: 'insert', input: '!' },
      { value: 'hello', cursor: 5 },
    )).toEqual({
      value: 'hello!',
      cursor: 6,
    });

    expect(CliV2PromptLineEditorService.applyCommand(
      { kind: 'move', direction: 'previousWord' },
      { value: 'hello world', cursor: 11 },
    )).toEqual({
      value: 'hello world',
      cursor: 6,
    });
  });
});
