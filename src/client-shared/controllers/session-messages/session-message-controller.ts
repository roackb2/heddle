import type { ControlPlaneSessionDetail, ControlPlaneSessionMessage } from '../../api/types.js';

/**
 * Shapes transient client-side session messages around persisted control-plane
 * session detail. This is shared by browser and terminal clients because the
 * behavior belongs to API-consumer state, not to a specific UI renderer.
 */
export class ClientSharedSessionMessageController {
  static appendOptimisticUserTurn(session: ControlPlaneSessionDetail, prompt: string): ControlPlaneSessionDetail {
    if (!session) {
      return session;
    }

    return {
      ...session,
      messages: [
        ...session.messages.filter((message) => !message.id.startsWith('live-')),
        {
          id: 'live-user',
          role: 'user',
          text: prompt,
        },
      ],
    };
  }

  static upsertLiveAssistantMessage(
    session: ControlPlaneSessionDetail,
    text: string,
    done: boolean | undefined,
  ): ControlPlaneSessionDetail {
    if (!session) {
      return session;
    }

    const messages = session.messages.filter((message) => message.id !== 'live-run-status');
    const lastMessage = messages.at(-1);
    if (lastMessage?.id === 'live-assistant' && lastMessage.role === 'assistant') {
      const nextMessages = [...messages];
      nextMessages[nextMessages.length - 1] =
        ClientSharedSessionMessageController.createLiveAssistantMessage(text, done);
      return {
        ...session,
        messages: nextMessages,
      };
    }

    return {
      ...session,
      messages: [
        ...messages,
        ClientSharedSessionMessageController.createLiveAssistantMessage(text, done),
      ],
    };
  }

  static mergeTransientMessages(
    current: ControlPlaneSessionDetail,
    next: ControlPlaneSessionDetail,
  ): ControlPlaneSessionDetail {
    if (!current || !next || current.id !== next.id || current.workspaceId !== next.workspaceId) {
      return next;
    }

    const nextMessageIds = new Set(next.messages.map((message) => message.id));
    const transientMessages = current.messages.filter((message) => (
      message.id.startsWith('live-') &&
      !nextMessageIds.has(message.id) &&
      !next.messages.some((persisted) => persisted.role === message.role && persisted.text === message.text)
    ));

    return transientMessages.length ? {
      ...next,
      messages: [
        ...next.messages,
        ...transientMessages,
      ],
    } : next;
  }

  private static createLiveAssistantMessage(text: string, done: boolean | undefined): ControlPlaneSessionMessage {
    return {
      id: 'live-assistant',
      role: 'assistant',
      text,
      isStreaming: !done,
      isPending: !done,
    };
  }
}
