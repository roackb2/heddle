import type { EventEmitter } from 'node:events';
import type { ToolCall, ToolDefinition } from '../../../../index.js';
import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import {
  ConversationActivityProjector,
  type ConversationActivity,
  type ConversationCompactionStatus,
} from '@/core/chat/engine/live/index.js';
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
      publishAgentLoopEvent(event: AgentLoopEvent) {
        publishActivities(ConversationActivityProjector.fromAgentLoopEvent(event));
      },

      publishCompactionStatus(event: ConversationCompactionStatus) {
        publishActivities(ConversationActivityProjector.fromCompactionStatus(event));
      },

      publishApprovalRequested(call: ToolCall) {
        publishActivities(ConversationActivityProjector.fromAgentLoopEvent({
          type: 'trace',
          runId: 'pending-approval',
          timestamp: new Date().toISOString(),
          event: {
            type: 'tool.approval_requested',
            call,
            step: 0,
            timestamp: new Date().toISOString(),
          },
        }));
      },
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
