import type { EventEmitter } from 'node:events';
import type {
  ControlPlaneSessionRunReference,
  ControlPlaneSessionRunTerminal,
  ControlPlaneSessionSignalEvent,
  ControlPlaneSessionsEventEnvelope,
} from '@/server/control-plane-types.js';

export class ControlPlaneChatSessionEventsController {
  static createSessionEventPublisher(args: {
    eventBus: EventEmitter;
    workspaceId: string;
    sessionId: string;
  }) {
    const publishSignal = (event: ControlPlaneSessionSignalEvent) => {
      args.eventBus.emit(ControlPlaneChatSessionEventsController.sessionAddressKey(args), event);
      args.eventBus.emit(
        ControlPlaneChatSessionEventsController.workspaceAddressKey(args),
        event satisfies ControlPlaneSessionsEventEnvelope,
      );
    };

    return {
      publishApprovalUpdated(
        approval: Extract<ControlPlaneSessionSignalEvent, { type: 'session.approval.updated' }>['approval'],
      ) {
        publishSignal({
          type: 'session.approval.updated',
          sessionId: args.sessionId,
          timestamp: new Date().toISOString(),
          approval,
        });
      },

      publishQueueUpdated(queuedPromptCount: number) {
        publishSignal({
          type: 'session.queue.updated',
          sessionId: args.sessionId,
          timestamp: new Date().toISOString(),
          queuedPromptCount,
        });
      },

      publishRunUpdated(run: ControlPlaneSessionRunReference, status: 'started' | 'settled') {
        publishSignal({
          type: 'session.run.updated',
          sessionId: args.sessionId,
          timestamp: new Date().toISOString(),
          status,
          run,
        });
      },

      publishWorkspaceRunTerminal(terminal: ControlPlaneSessionRunTerminal) {
        args.eventBus.emit(ControlPlaneChatSessionEventsController.workspaceAddressKey(args), {
          type: 'session.run.terminal',
          sessionId: args.sessionId,
          timestamp: terminal.timestamp,
          terminal,
        } satisfies ControlPlaneSessionsEventEnvelope);
      },
    };
  }

  private static sessionAddressKey(address: { workspaceId: string; sessionId: string }): string {
    return `${address.workspaceId}:${address.sessionId}`;
  }

  static workspaceAddressKey(address: { workspaceId: string }): string {
    return `workspace:${address.workspaceId}`;
  }
}
