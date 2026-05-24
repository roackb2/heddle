import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import type { ControlPlaneSessionDetail } from '@web/hooks/sessions/useControlPlaneSessionDetail';

type ConversationAutoScrollMessage = NonNullable<ControlPlaneSessionDetail>['messages'][number];

type UseConversationAutoScrollArgs = {
  liveStatus?: string;
  messages: ConversationAutoScrollMessage[];
  sessionId?: string;
  submitting: boolean;
};

const userScrollKeys = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

// Owns the conversation viewport policy: enter at the bottom, follow active
// responses, and stop following once the user scrolls during that response.
export function useConversationAutoScroll({
  liveStatus,
  messages,
  sessionId,
  submitting,
}: UseConversationAutoScrollArgs) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const userScrollIntentRef = useRef(false);
  const previousResponseActiveRef = useRef(false);
  const programmaticScrollFrameRef = useRef<number | undefined>(undefined);
  const responseActive = Boolean(
    submitting ||
    liveStatus ||
    messages.some((message) => message.isStreaming || message.isPending),
  );
  const conversationScrollKey = useMemo(() => {
    const lastMessage = messages.at(-1);
    return [
      sessionId,
      messages.length,
      lastMessage?.id,
      lastMessage?.text.length,
      lastMessage?.isStreaming,
      lastMessage?.isPending,
      liveStatus,
    ].join(':');
  }, [liveStatus, messages, sessionId]);
  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    if (programmaticScrollFrameRef.current) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
    }

    userScrollIntentRef.current = false;
    container.dataset.programmaticScroll = 'true';
    container.scrollTop = container.scrollHeight;
    programmaticScrollFrameRef.current = window.requestAnimationFrame(() => {
      delete container.dataset.programmaticScroll;
      programmaticScrollFrameRef.current = undefined;
    });
  }, []);
  const handleUserScrollIntent = useCallback(() => {
    if (responseActive) {
      userScrollIntentRef.current = true;
    }
  }, [responseActive]);
  const handleScrollKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (userScrollKeys.has(event.key)) {
      handleUserScrollIntent();
    }
  }, [handleUserScrollIntent]);
  const handleConversationScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || container.dataset.programmaticScroll === 'true') {
      return;
    }

    if (responseActive && userScrollIntentRef.current) {
      autoScrollEnabledRef.current = false;
    }
  }, [responseActive]);

  useEffect(() => () => {
    if (programmaticScrollFrameRef.current) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    if (!sessionId) {
      return;
    }

    autoScrollEnabledRef.current = true;
    userScrollIntentRef.current = false;
    scrollToBottom();
  }, [scrollToBottom, sessionId]);

  useEffect(() => {
    if (responseActive && !previousResponseActiveRef.current) {
      autoScrollEnabledRef.current = true;
      userScrollIntentRef.current = false;
      scrollToBottom();
    }

    if (!responseActive) {
      userScrollIntentRef.current = false;
    }

    previousResponseActiveRef.current = responseActive;
  }, [responseActive, scrollToBottom]);

  useLayoutEffect(() => {
    if (autoScrollEnabledRef.current) {
      scrollToBottom();
    }
  }, [conversationScrollKey, scrollToBottom]);

  return {
    scrollContainerRef,
    scrollContainerProps: {
      onKeyDown: handleScrollKeyDown,
      onPointerDown: handleUserScrollIntent,
      onScroll: handleConversationScroll,
      onTouchStart: handleUserScrollIntent,
      onWheel: handleUserScrollIntent,
    },
  };
}
