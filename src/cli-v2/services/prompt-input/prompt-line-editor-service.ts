import { ClientSharedPromptInputService } from '@/client-shared/services/prompt-input/index.js';
import type { ClientSharedPromptDraftState } from '@/client-shared/services/prompt-input/index.js';
import type { PromptInputKey } from '../../components/PromptInput.js';

export type CliV2PromptInputCommand =
  | { kind: 'submit' }
  | { kind: 'insert'; input: string }
  | { kind: 'history'; direction: 'previous' | 'next' }
  | { kind: 'deletePreviousCharacter' }
  | { kind: 'deletePreviousWord' }
  | { kind: 'deleteBeforeCursor' }
  | { kind: 'deleteAfterCursor' }
  | { kind: 'move'; direction: 'start' | 'end' | 'previousCharacter' | 'nextCharacter' | 'previousWord' | 'nextWord' };

const CTRL_TEXT_COMMANDS = new Map<string, CliV2PromptInputCommand>([
  ['a', { kind: 'move', direction: 'start' }],
  ['e', { kind: 'move', direction: 'end' }],
  ['k', { kind: 'deleteAfterCursor' }],
  ['u', { kind: 'deleteBeforeCursor' }],
  ['w', { kind: 'deletePreviousWord' }],
]);

const META_TEXT_COMMANDS = new Map<string, CliV2PromptInputCommand>([
  ['b', { kind: 'move', direction: 'previousWord' }],
  ['f', { kind: 'move', direction: 'nextWord' }],
]);

/**
 * Owns cli-v2 terminal key translation for the prompt line editor.
 *
 * Terminal input is host-specific: Option usually arrives as Meta, while Cmd
 * only arrives as Super in terminals that support the Kitty keyboard protocol.
 * This service maps the keys Ink exposes into shared prompt text operations.
 */
export class CliV2PromptLineEditorService {
  static resolveCommand(input: string, key: PromptInputKey): CliV2PromptInputCommand | undefined {
    if (key.return) {
      return key.shift ? { kind: 'insert', input: '\n' } : { kind: 'submit' };
    }

    if (key.ctrl && input) {
      return CTRL_TEXT_COMMANDS.get(input);
    }

    if (key.meta && input) {
      return META_TEXT_COMMANDS.get(input);
    }

    if (key.super && key.backspace) {
      return { kind: 'deleteBeforeCursor' };
    }

    if (key.meta && key.backspace) {
      return { kind: 'deletePreviousWord' };
    }

    if (key.backspace || key.delete) {
      return { kind: 'deletePreviousCharacter' };
    }

    if (key.super && key.leftArrow) {
      return { kind: 'move', direction: 'start' };
    }

    if (key.super && key.rightArrow) {
      return { kind: 'move', direction: 'end' };
    }

    if (key.meta && key.leftArrow) {
      return { kind: 'move', direction: 'previousWord' };
    }

    if (key.meta && key.rightArrow) {
      return { kind: 'move', direction: 'nextWord' };
    }

    if (key.leftArrow) {
      return { kind: 'move', direction: 'previousCharacter' };
    }

    if (key.rightArrow) {
      return { kind: 'move', direction: 'nextCharacter' };
    }

    if (key.upArrow) {
      return { kind: 'history', direction: 'previous' };
    }

    if (key.downArrow) {
      return { kind: 'history', direction: 'next' };
    }

    if (key.home) {
      return { kind: 'move', direction: 'start' };
    }

    if (key.end) {
      return { kind: 'move', direction: 'end' };
    }

    if (key.ctrl || key.meta || key.super || key.escape || key.tab || !input) {
      return undefined;
    }

    return { kind: 'insert', input };
  }

  static applyCommand(
    command: Exclude<CliV2PromptInputCommand, { kind: 'submit' | 'history' }>,
    state: ClientSharedPromptDraftState,
  ): ClientSharedPromptDraftState {
    if (command.kind === 'insert') {
      return ClientSharedPromptInputService.insertText(state, command.input);
    }

    if (command.kind === 'move') {
      return {
        value: state.value,
        cursor: ClientSharedPromptInputService.moveCursor(state, command.direction),
      };
    }

    const actions: Record<typeof command.kind, () => ClientSharedPromptDraftState> = {
      deletePreviousCharacter: () => ClientSharedPromptInputService.deletePreviousCharacter(state),
      deletePreviousWord: () => ClientSharedPromptInputService.deletePreviousWord(state),
      deleteBeforeCursor: () => ClientSharedPromptInputService.deleteBeforeCursor(state),
      deleteAfterCursor: () => ClientSharedPromptInputService.deleteAfterCursor(state),
    };

    return actions[command.kind]();
  }
}
