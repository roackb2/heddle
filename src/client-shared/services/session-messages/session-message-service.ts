import type { ControlPlaneSessionDetail, ControlPlaneSessionMessage } from '../../api/types.js';

/**
 * Shapes transient assistant stream messages around persisted control-plane
 * session detail. Accepted user messages are server-owned and must arrive from
 * the API snapshot, so this service intentionally does not preserve client-only
 * user messages.
 */
export class ClientSharedSessionMessageService {
  static upsertLiveAssistantMessage(
    session: ControlPlaneSessionDetail,
    text: string,
    done: boolean | undefined,
  ): ControlPlaneSessionDetail {
    if (!session) {
      return session;
    }

    const messages = session.messages.filter((message) => !ClientSharedSessionMessageService.isTransientActivityMessage(message.id));

    return {
      ...session,
      messages: [
        ...messages,
        ClientSharedSessionMessageService.createLiveAssistantMessage(text, done),
      ],
    };
  }

  static upsertLiveCommentaryMessage(
    session: ControlPlaneSessionDetail,
    messageId: string,
    text: string,
    done: boolean,
  ): ControlPlaneSessionDetail {
    if (!session) {
      return session;
    }

    const id = `live-commentary:${messageId}`;
    return {
      ...session,
      messages: [
        ...session.messages.filter((message) => (
          message.id !== id
          && message.id !== 'live-reasoning'
          && message.id !== 'live-run-status'
        )),
        {
          id,
          role: 'assistant',
          text,
          isStreaming: !done,
          isPending: true,
        },
      ],
    };
  }

  static upsertLiveReasoningMessage(
    session: ControlPlaneSessionDetail,
    text: string,
  ): ControlPlaneSessionDetail {
    if (!session) {
      return session;
    }

    return {
      ...session,
      messages: [
        ...session.messages.filter((message) => (
          message.id !== 'live-reasoning' && message.id !== 'live-run-status'
        )),
        {
          id: 'live-reasoning',
          role: 'assistant',
          text,
          isStreaming: true,
          isPending: true,
        },
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
      ClientSharedSessionMessageService.isPreservedLiveMessage(message.id) &&
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

  private static isTransientActivityMessage(id: string): boolean {
    return id === 'live-run-status'
      || id === 'live-assistant'
      || id === 'live-reasoning'
      || id.startsWith('live-commentary:');
  }

  private static isPreservedLiveMessage(id: string): boolean {
    return id === 'live-assistant'
      || id === 'live-reasoning'
      || id.startsWith('live-commentary:');
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
