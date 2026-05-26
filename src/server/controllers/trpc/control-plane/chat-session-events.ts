import type { EventEmitter } from 'node:events';
import type { ConversationActivity } from '@/core/live/index.js';
import type { ControlPlaneSessionLiveEvent } from '@/server/control-plane-types.js';

export class ControlPlaneChatSessionEventsController {
  static emitSessionActivities(args: {
    eventBus: EventEmitter;
    workspaceId: string;
    sessionId: string;
    activities: ConversationActivity[];
  }) {
    if (args.activities.length === 0) {
      return;
    }

    args.eventBus.emit(ControlPlaneChatSessionEventsController.sessionAddressKey(args), {
      sessionId: args.sessionId,
      timestamp: new Date().toISOString(),
      activities: args.activities,
    } satisfies ControlPlaneSessionLiveEvent);
  }

  static createSessionEventPublisher(args: {
    eventBus: EventEmitter;
    workspaceId: string;
    sessionId: string;
  }) {
    const publishActivities = (activities: ConversationActivity[]) => {
      ControlPlaneChatSessionEventsController.emitSessionActivities({
        eventBus: args.eventBus,
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
        activities,
      });
    };

    const publisher = {
      publishActivity(activity: ConversationActivity) {
        publishActivities([activity]);
      },

      publishActivities,
    };

    return publisher;
  }

  private static sessionAddressKey(address: { workspaceId: string; sessionId: string }): string {
    return `${address.workspaceId}:${address.sessionId}`;
  }
}
