/**
 * Control-plane heartbeat event controller.
 *
 * Bridges in-process heartbeat scheduler events to tRPC subscriptions. It is a
 * transport adapter only: heartbeat vocabulary stays in core, and persistence
 * stays behind the heartbeat task service.
 */
import { EventEmitter } from 'node:events';
import { FileHeartbeatTaskService, type AgentHeartbeatEvent, type HeartbeatSchedulerEvent } from '@/core/heartbeat/index.js';
import type { ControlPlaneHeartbeatAgentEvent, ControlPlaneHeartbeatEvent, ControlPlaneHeartbeatEventEnvelope } from '../types.js';

export class ControlPlaneHeartbeatEventsController {
  private readonly eventBus = new EventEmitter();

  publish(args: {
    workspaceId: string;
    event: HeartbeatSchedulerEvent;
  }): void {
    const event = ControlPlaneHeartbeatEventsController.projectEvent(args.event);
    this.eventBus.emit(args.workspaceId, {
      type: 'heartbeat.event',
      workspaceId: args.workspaceId,
      timestamp: ControlPlaneHeartbeatEventsController.resolveEventTimestamp(event),
      event,
    } satisfies ControlPlaneHeartbeatEventEnvelope);
  }

  async *subscribe(args: {
    workspaceId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ControlPlaneHeartbeatEventEnvelope> {
    const queue = new ControlPlaneHeartbeatEventQueue();
    const listener = (event: ControlPlaneHeartbeatEventEnvelope) => queue.push(event);
    this.eventBus.on(args.workspaceId, listener);

    const heartbeat = setInterval(() => {
      queue.push({
        type: 'heartbeat',
        workspaceId: args.workspaceId,
        timestamp: new Date().toISOString(),
      });
    }, 15000);
    heartbeat.unref?.();

    const abort = () => queue.close();
    args.signal?.addEventListener('abort', abort, { once: true });

    queue.push({
      type: 'ready',
      workspaceId: args.workspaceId,
      timestamp: new Date().toISOString(),
    });

    try {
      for await (const event of queue) {
        yield event;
      }
    } finally {
      clearInterval(heartbeat);
      this.eventBus.off(args.workspaceId, listener);
      args.signal?.removeEventListener('abort', abort);
      queue.close();
    }
  }

  private static projectEvent(event: HeartbeatSchedulerEvent): ControlPlaneHeartbeatEvent {
    if (event.type === 'heartbeat.task.finished') {
      return {
        ...event,
        record: FileHeartbeatTaskService.projectRunRecordView(event.record),
      };
    }

    if (event.type === 'heartbeat.task.agent_event') {
      return {
        ...event,
        event: ControlPlaneHeartbeatEventsController.projectAgentEvent(event.event),
      };
    }

    return event;
  }

  private static projectAgentEvent(event: AgentHeartbeatEvent): ControlPlaneHeartbeatAgentEvent {
    const base = {
      type: event.type,
      timestamp: 'timestamp' in event && typeof event.timestamp === 'string' ? event.timestamp : undefined,
      runId: 'runId' in event && typeof event.runId === 'string' ? event.runId : undefined,
    };

    const projectors: Record<string, () => ControlPlaneHeartbeatAgentEvent> = {
      'tool.calling': () => ({
        ...base,
        tool: 'tool' in event && typeof event.tool === 'string' ? event.tool : undefined,
      }),
      'tool.completed': () => ({
        ...base,
        tool: 'tool' in event && typeof event.tool === 'string' ? event.tool : undefined,
      }),
      'assistant.stream': () => ({
        ...base,
        done: 'done' in event && event.done === true,
      }),
      'heartbeat.decision': () => ({
        ...base,
        decision: 'decision' in event ? event.decision : undefined,
        outcome: 'outcome' in event ? event.outcome : undefined,
      }),
      'escalation.required': () => ({
        ...base,
        outcome: 'outcome' in event ? event.outcome : undefined,
        step: 'step' in event ? event.step : undefined,
      }),
      'checkpoint.saved': () => ({
        ...base,
        step: 'step' in event ? event.step : undefined,
      }),
    };

    return projectors[event.type]?.() ?? base;
  }

  private static resolveEventTimestamp(event: ControlPlaneHeartbeatEvent): string {
    return 'timestamp' in event && typeof event.timestamp === 'string' ? event.timestamp : new Date().toISOString();
  }
}

class ControlPlaneHeartbeatEventQueue implements AsyncIterable<ControlPlaneHeartbeatEventEnvelope> {
  private readonly events: ControlPlaneHeartbeatEventEnvelope[] = [];
  private readonly waiters: Array<(event: ControlPlaneHeartbeatEventEnvelope | undefined) => void> = [];
  private closed = false;

  push(event: ControlPlaneHeartbeatEventEnvelope): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }

    this.events.push(event);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.waiters.splice(0).forEach((waiter) => waiter(undefined));
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ControlPlaneHeartbeatEventEnvelope> {
    while (!this.closed || this.events.length > 0) {
      const event = this.events.shift() ?? await new Promise<ControlPlaneHeartbeatEventEnvelope | undefined>((resolve) => {
        this.waiters.push(resolve);
      });
      if (!event) {
        break;
      }

      yield event;
    }
  }
}

export const controlPlaneHeartbeatEventsController = new ControlPlaneHeartbeatEventsController();
