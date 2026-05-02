import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { ChatSessionDetail } from '../../../../lib/api';

export function useLiveSessionMessages(setSessionDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>) {
  const appendPendingUserTurn = useCallback((prompt: string) => {
    setSessionDetail((current) => {
      if (!current) {
        return current;
      }

      const nextMessages = current.messages.filter((message) => (
        message.id !== 'live-user'
        && message.id !== 'live-assistant'
        && message.id !== 'live-run-status'
      ));
      return {
        ...current,
        messages: [
          ...nextMessages,
          {
            id: 'live-user',
            role: 'user',
            text: prompt,
          },
          {
            id: 'live-run-status',
            role: 'assistant',
            text: 'Heddle is working…',
            isStreaming: true,
            isPending: true,
          },
        ],
      };
    });
  }, [setSessionDetail]);

  const upsertLiveStatusMessage = useCallback((id: string, text: string, options?: { pending?: boolean; streaming?: boolean }) => {
    setSessionDetail((current) => {
      if (!current) {
        return current;
      }

      const nextMessages = [...current.messages];
      const existingIndex = nextMessages.findIndex((message) => message.id === id);
      const nextMessage = {
        id,
        role: 'assistant' as const,
        text,
        isPending: options?.pending,
        isStreaming: options?.streaming,
      };

      if (existingIndex >= 0) {
        nextMessages[existingIndex] = nextMessage;
      } else {
        nextMessages.push(nextMessage);
      }

      return {
        ...current,
        messages: nextMessages,
      };
    });
  }, [setSessionDetail]);

  const removeLiveStatusMessage = useCallback((id: string) => {
    setSessionDetail((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        messages: current.messages.filter((message) => message.id !== id),
      };
    });
  }, [setSessionDetail]);

  const upsertLiveAssistantMessage = useCallback((text: string, isDone: boolean) => {
    setSessionDetail((current) => {
      if (!current) {
        return current;
      }

      const nextMessages = current.messages.filter((message) => message.id !== 'live-run-status');
      const lastMessage = nextMessages.at(-1);
      if (lastMessage?.id === 'live-assistant' && lastMessage.role === 'assistant') {
        nextMessages[nextMessages.length - 1] = {
          ...lastMessage,
          text,
          isStreaming: !isDone,
          isPending: !isDone,
        };
      } else {
        nextMessages.push({
          id: 'live-assistant',
          role: 'assistant',
          text,
          isStreaming: !isDone,
          isPending: !isDone,
        });
      }

      return {
        ...current,
        messages: nextMessages,
      };
    });
  }, [setSessionDetail]);

  return useMemo(() => ({
    appendPendingUserTurn,
    upsertLiveStatusMessage,
    removeLiveStatusMessage,
    upsertLiveAssistantMessage,
  }), [appendPendingUserTurn, removeLiveStatusMessage, upsertLiveAssistantMessage, upsertLiveStatusMessage]);
}

export function mergeTransientMessages(current: ChatSessionDetail | null, next: ChatSessionDetail | null): ChatSessionDetail | null {
  if (!current || !next || current.id !== next.id) {
    return next;
  }

  const transientMessages = current.messages.filter((message) => message.id.startsWith('live-'));
  if (!transientMessages.length) {
    return next;
  }

  const nextMessageIds = new Set(next.messages.map((message) => message.id));
  return {
    ...next,
    messages: [
      ...next.messages,
      ...transientMessages.filter((message) => !nextMessageIds.has(message.id)),
    ],
  };
}
