import type { EventEmitter } from 'node:events';
import type { ConversationActivity } from '@/core/live/index.js';
import type {
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionLiveEvent,
  ControlPlaneSessionsEventEnvelope,
} from '@/server/control-plane-types.js';

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

    const event = {
      sessionId: args.sessionId,
      timestamp: new Date().toISOString(),
      activities: args.activities,
    } satisfies ControlPlaneSessionLiveEvent;

    args.eventBus.emit(ControlPlaneChatSessionEventsController.sessionAddressKey(args), event);
    args.eventBus.emit(ControlPlaneChatSessionEventsController.workspaceAddressKey(args), {
      ...event,
      type: 'session.event',
    } satisfies ControlPlaneSessionsEventEnvelope);
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

      publishApprovalUpdated() {
        args.eventBus.emit(ControlPlaneChatSessionEventsController.sessionAddressKey(args), {
          type: 'session.approval.updated',
          sessionId: args.sessionId,
          timestamp: new Date().toISOString(),
        } satisfies ControlPlaneSessionEventEnvelope);
      },

      publishQueueUpdated(queuedPromptCount: number) {
        args.eventBus.emit(ControlPlaneChatSessionEventsController.sessionAddressKey(args), {
          type: 'session.queue.updated',
          sessionId: args.sessionId,
          timestamp: new Date().toISOString(),
          queuedPromptCount,
        } satisfies ControlPlaneSessionEventEnvelope);
      },
    };

    return publisher;
  }

  private static sessionAddressKey(address: { workspaceId: string; sessionId: string }): string {
    return `${address.workspaceId}:${address.sessionId}`;
  }

  static workspaceAddressKey(address: { workspaceId: string }): string {
    return `workspace:${address.workspaceId}`;
  }
}
