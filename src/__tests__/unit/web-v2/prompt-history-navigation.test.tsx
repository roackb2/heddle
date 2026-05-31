// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { createRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { usePromptHistoryNavigation } from '../../../web-v2/hooks/conversation/usePromptHistoryNavigation.js';

describe('usePromptHistoryNavigation', () => {
  it('recalls submitted prompts with ArrowUp and restores the draft with ArrowDown', () => {
    const textarea = document.createElement('textarea');
    const textareaRef = createRef<HTMLTextAreaElement>();
    textareaRef.current = textarea;

    const { result } = renderHook(() => {
      const [value, setValue] = useState('draft');
      const history = usePromptHistoryNavigation({
        value,
        onValueChange: setValue,
        textareaRef,
      });

      return { value, setValue, history };
    });

    act(() => {
      result.current.history.recordPrompt('first prompt');
      result.current.history.recordPrompt('second prompt');
    });

    textarea.value = 'draft';
    textarea.selectionStart = 0;
    textarea.selectionEnd = 0;
    act(() => {
      result.current.history.handleKeyDown(createKeyEvent('ArrowUp', textarea));
    });

    expect(result.current.value).toBe('second prompt');

    textarea.value = 'second prompt';
    textarea.selectionStart = 'second prompt'.length;
    textarea.selectionEnd = 'second prompt'.length;
    act(() => {
      result.current.history.handleKeyDown(createKeyEvent('ArrowDown', textarea));
    });

    expect(result.current.value).toBe('draft');
  });
});

function createKeyEvent(key: string, currentTarget: HTMLTextAreaElement) {
  return {
    key,
    currentTarget,
    defaultPrevented: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}
