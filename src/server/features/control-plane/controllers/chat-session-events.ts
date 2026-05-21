import type { EventEmitter } from 'node:events';
import type { ToolCall, ToolDefinition } from '../../../../index.js';
import type { ConversationActivity } from '@/core/chat/engine/live/index.js';
import type { ControlPlaneSessionLiveEvent } from '../types.js';

export class ControlPlaneChatSessionEventsController {
  static emitSessionActivities(args: {
    eventBus: EventEmitter;
    sessionId: string;
    activities: ConversationActivity[];
  }) {
    if (args.activities.length === 0) {
      return;
    }

    args.eventBus.emit(args.sessionId, {
      sessionId: args.sessionId,
      timestamp: new Date().toISOString(),
      activities: args.activities,
    } satisfies ControlPlaneSessionLiveEvent);
  }

  static createSessionEventPublisher(args: {
    eventBus: EventEmitter;
    sessionId: string;
  }) {
    const publishActivities = (activities: ConversationActivity[]) => {
      ControlPlaneChatSessionEventsController.emitSessionActivities({
        eventBus: args.eventBus,
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

  static createPendingApprovalView(call: ToolCall, tool: ToolDefinition) {
    return {
      tool: tool.name,
      callId: call.id,
      input: call.input,
      requestedAt: new Date().toISOString(),
    };
  }
}
