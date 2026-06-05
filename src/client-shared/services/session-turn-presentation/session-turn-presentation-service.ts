import type {
  ControlPlaneSessionDetail,
  ControlPlaneSessionTurn,
} from '../../api/types.js';
import type { ConversationTurnPresentationTimelineItem } from '@/core/chat/types.js';

export type ClientSharedSessionTurnPresentationItem = {
  id: string;
  turnId: string;
  turnPrompt: string;
  activity: ConversationTurnPresentationTimelineItem;
};

/**
 * Owns frontend-neutral projection of persisted turn presentation metadata.
 *
 * Core owns which tool facts become durable turn presentation metadata. This
 * service owns the shared client-side shape that web-v2 and cli-v2 can render
 * differently. It does not parse raw traces, inspect tool payloads, or decide
 * host-specific layout, keyboard shortcuts, or collapse state.
 */
export class ClientSharedSessionTurnPresentationService {
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
}
