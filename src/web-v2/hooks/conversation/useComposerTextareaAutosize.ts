import { useLayoutEffect, type RefObject } from 'react';

const composerTextareaMinHeight = 28;
const composerTextareaMaxHeight = 176;

// Owns the composer textarea's DOM sizing policy as draft content changes.
export function useComposerTextareaAutosize(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = `${composerTextareaMinHeight}px`;
    const nextHeight = Math.min(textarea.scrollHeight, composerTextareaMaxHeight);
    textarea.style.height = `${Math.max(nextHeight, composerTextareaMinHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > composerTextareaMaxHeight ? 'auto' : 'hidden';
  }, [textareaRef, value]);
}
