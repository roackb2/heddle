import type {
  ControlPlaneSessionDetail,
  ControlPlaneSessionMessage,
  ControlPlaneSessionTurn,
} from '../../api/types.js';
import type { ConversationTurnPresentationTimelineItem } from '@/core/chat/types.js';

export type ClientSharedSessionTurnPresentationItem = {
  id: string;
  turnId: string;
  turnPrompt: string;
  activity: ConversationTurnPresentationTimelineItem;
};

export type ClientSharedConversationTimelineMessageItem = {
  type: 'message';
  id: string;
  message: ControlPlaneSessionMessage;
};

export type ClientSharedConversationTimelineActivityItem = {
  type: 'turn_activity';
  id: string;
  turnId: string;
  turnPrompt: string;
  activity: ConversationTurnPresentationTimelineItem;
};

export type ClientSharedConversationTimelineItem =
  | ClientSharedConversationTimelineMessageItem
  | ClientSharedConversationTimelineActivityItem;

/**
 * Owns frontend-neutral projection of persisted turn presentation metadata.
 *
 * Core owns which tool facts become durable turn presentation metadata. This
 * service owns the shared client-side shape that web-v2 and cli-v2 can render
 * differently. It does not parse raw traces, inspect tool payloads, or decide
 * host-specific layout, keyboard shortcuts, or collapse state.
 */
export class ClientSharedSessionTurnPresentationService {
  static projectConversationTimeline(
    session: ControlPlaneSessionDetail | undefined | null,
  ): ClientSharedConversationTimelineItem[] {
    if (!session) {
      return [];
    }

    const placedTurnIds = new Set<string>();
    const timeline = session.messages.flatMap((message) => {
      const messageItem: ClientSharedConversationTimelineMessageItem = {
        type: 'message',
        id: message.id,
        message,
      };

      if (message.role !== 'user') {
        return [messageItem];
      }

      const turn = ClientSharedSessionTurnPresentationService.findUnplacedTurnForPrompt({
        turns: session.turns,
        placedTurnIds,
        prompt: message.text,
      });
      if (!turn) {
        return [messageItem];
      }

      placedTurnIds.add(turn.id);
      return [
        messageItem,
        ...ClientSharedSessionTurnPresentationService.projectConversationActivityItems(turn),
      ];
    });

    return [
      ...timeline,
      ...session.turns
        .filter((turn) => !placedTurnIds.has(turn.id))
        .flatMap((turn) => ClientSharedSessionTurnPresentationService.projectConversationActivityItems(turn)),
    ];
  }

  static projectTurnActivities(
    session: ControlPlaneSessionDetail | undefined | null,
  ): ClientSharedSessionTurnPresentationItem[] {
    return session?.turns.flatMap((turn) => (
      ClientSharedSessionTurnPresentationService.projectTurnActivityItems(turn)
    )) ?? [];
  }

  static projectTurnActivityItems(turn: ControlPlaneSessionTurn): ClientSharedSessionTurnPresentationItem[] {
    return turn.presentation?.timelineItems.map((activity) => ({
      id: activity.id,
      turnId: turn.id,
      turnPrompt: turn.prompt,
      activity,
    })) ?? [];
  }

  private static projectConversationActivityItems(turn: ControlPlaneSessionTurn): ClientSharedConversationTimelineActivityItem[] {
    return ClientSharedSessionTurnPresentationService.projectTurnActivityItems(turn).map((item) => ({
      ...item,
      type: 'turn_activity' as const,
    }));
  }

  private static findUnplacedTurnForPrompt({
    placedTurnIds,
    prompt,
    turns,
  }: {
    placedTurnIds: Set<string>;
    prompt: string;
    turns: ControlPlaneSessionTurn[];
  }): ControlPlaneSessionTurn | undefined {
    return turns.find((turn) => !placedTurnIds.has(turn.id) && turn.prompt.trim() === prompt.trim());
  }
}
