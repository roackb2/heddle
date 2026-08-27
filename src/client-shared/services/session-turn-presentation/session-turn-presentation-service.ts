import type {
  ControlPlaneSessionDetail,
  ControlPlaneSessionMessage,
  ControlPlaneSessionTurn,
} from '../../api/types.js';
import type { ConversationTurnPresentationTimelineItem } from '@heddleagent/runtime/cli';
import {
  ClientSharedSessionDelegationService,
  type ClientSharedDelegationView,
} from '../session-delegations/index.js';

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
  turnAgent?: ControlPlaneSessionTurn['agent'];
};

export type ClientSharedConversationTimelineActivityGroupItem = {
  type: 'turn_activity_group';
  id: string;
  turnId: string;
  turnPrompt: string;
  activities: ConversationTurnPresentationTimelineItem[];
};

export type ClientSharedConversationTimelineDelegationGroupItem = {
  type: 'turn_delegation_group';
  id: string;
  turnId: string;
  turnPrompt: string;
  delegations: ClientSharedDelegationView[];
};

export type ClientSharedConversationTimelineItem =
  | ClientSharedConversationTimelineMessageItem
  | ClientSharedConversationTimelineDelegationGroupItem
  | ClientSharedConversationTimelineActivityGroupItem;

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
      if (message.role !== 'user') {
        return [{
          type: 'message',
          id: message.id,
          message,
        } satisfies ClientSharedConversationTimelineMessageItem];
      }

      const turn = ClientSharedSessionTurnPresentationService.findUnplacedTurnForPrompt({
        turns: session.turns,
        placedTurnIds,
        prompt: message.text,
      });
      const messageItem: ClientSharedConversationTimelineMessageItem = {
        type: 'message',
        id: message.id,
        message,
        turnAgent: turn?.agent,
      };
      if (!turn) {
        return [messageItem];
      }

      placedTurnIds.add(turn.id);
      return [
        messageItem,
        ...ClientSharedSessionTurnPresentationService.projectConversationTurnGroups(turn),
      ];
    });

    return [
      ...timeline,
      ...session.turns
        .filter((turn) => !placedTurnIds.has(turn.id))
        .flatMap((turn) => ClientSharedSessionTurnPresentationService.projectConversationTurnGroups(turn)),
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

  private static projectConversationActivityGroup(turn: ControlPlaneSessionTurn): ClientSharedConversationTimelineActivityGroupItem[] {
    const activities = turn.presentation?.timelineItems ?? [];
    if (activities.length === 0) {
      return [];
    }

    return [{
      type: 'turn_activity_group',
      id: `${turn.id}:activity-group`,
      turnId: turn.id,
      turnPrompt: turn.prompt,
      activities,
    }];
  }

  private static projectConversationDelegationGroup(turn: ControlPlaneSessionTurn): ClientSharedConversationTimelineDelegationGroupItem[] {
    const delegations = ClientSharedSessionDelegationService.projectSettled(turn.delegations ?? []);
    if (delegations.length === 0) {
      return [];
    }

    return [{
      type: 'turn_delegation_group',
      id: `${turn.id}:delegation-group`,
      turnId: turn.id,
      turnPrompt: turn.prompt,
      delegations,
    }];
  }

  private static projectConversationTurnGroups(turn: ControlPlaneSessionTurn): ClientSharedConversationTimelineItem[] {
    return [
      ...ClientSharedSessionTurnPresentationService.projectConversationDelegationGroup(turn),
      ...ClientSharedSessionTurnPresentationService.projectConversationActivityGroup(turn),
    ];
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
