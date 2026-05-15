import type { EventEmitter } from 'node:events';
import type { ToolCall, ToolDefinition } from '../../../../index.js';
import type { AgentLoopEvent } from '../../../../core/runtime/agent-loop.js';
import type { ControlPlaneSessionLiveEvent } from '../types.js';

export class ControlPlaneChatSessionEventsController {
  static emitSessionEvent(args: {
    eventBus: EventEmitter;
    sessionId: string;
    event: ControlPlaneSessionLiveEvent['event'];
  }) {
    args.eventBus.emit(args.sessionId, {
      sessionId: args.sessionId,
      timestamp: new Date().toISOString(),
      event: args.event,
    } satisfies ControlPlaneSessionLiveEvent);
  }

  static createSessionEventPublisher(args: {
    eventBus: EventEmitter;
    sessionId: string;
  }) {
    const publishEvent = (event: ControlPlaneSessionLiveEvent['event']) => {
      ControlPlaneChatSessionEventsController.emitSessionEvent({
        eventBus: args.eventBus,
        sessionId: args.sessionId,
        event,
      });
    };

    const publisher = {
      publishAgentLoopEvent(event: AgentLoopEvent) {
        publishEvent(event);
      },

      publishCompactionStatus(event: ControlPlaneSessionLiveEvent['event']) {
        publishEvent(event);
      },

      publishApprovalRequested(call: ToolCall) {
        publishEvent({
          type: 'trace',
          runId: 'pending-approval',
          timestamp: new Date().toISOString(),
          event: {
            type: 'tool.approval_requested',
            call,
            step: 0,
            timestamp: new Date().toISOString(),
          },
        });
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
