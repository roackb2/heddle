import type { EventEmitter } from 'node:events';
import type { ToolCall, ToolDefinition } from '../../../../index.js';
import type { ChatTurnCompactionPort, ChatTurnEventPort, ChatTurnHostPort } from '../../../../core/chat/engine/turns/host-bridge.js';
import type { AgentLoopEvent } from '../../../../core/runtime/agent-loop.js';
import type { ControlPlaneSessionLiveEvent } from '../types.js';

export function emitControlPlaneSessionEvent(args: {
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

export function createControlPlaneSessionEventPublisher(args: {
  eventBus: EventEmitter;
  sessionId: string;
}) {
  const publishEvent = (event: ControlPlaneSessionLiveEvent['event']) => {
    emitControlPlaneSessionEvent({
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

  const events: ChatTurnEventPort = {
    onAgentLoopEvent: publisher.publishAgentLoopEvent,
  };
  const compaction: ChatTurnCompactionPort = {
    onPreflightCompactionStatus: publisher.publishCompactionStatus,
    onFinalCompactionStatus: publisher.publishCompactionStatus,
  };
  const hostPort: ChatTurnHostPort = {
    events,
    compaction,
  };

  return {
    ...publisher,
    hostPort,
  };
}

export function createControlPlanePendingApprovalView(call: ToolCall, tool: ToolDefinition) {
  return {
    tool: tool.name,
    callId: call.id,
    input: call.input,
    requestedAt: new Date().toISOString(),
  };
}
