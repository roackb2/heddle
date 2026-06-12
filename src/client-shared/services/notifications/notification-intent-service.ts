import {
  ClientSharedSessionActivityService,
} from '@/client-shared/services/session-activities/index.js';
import type {
  ClientSharedHeartbeatEventEnvelope,
  ClientSharedNotificationIntent,
  ClientSharedSessionNotificationActivity,
} from './types.js';

type SessionActivityInput = {
  workspaceId?: string;
  sessionId: string;
  activity: ClientSharedSessionNotificationActivity;
};

type HeartbeatEnvelopeInput = {
  workspaceId?: string;
  envelope: ClientSharedHeartbeatEventEnvelope;
};

type NotificationMemoryOptions = {
  maxSeenKeys?: number;
};

const DEFAULT_MAX_SEEN_KEYS = 200;

/**
 * Owns frontend-neutral notification intent projection from shared control-plane
 * event facts. Browser and terminal clients own delivery mechanics; this
 * service owns which existing events deserve user-facing notification.
 */
export class ClientSharedNotificationIntentService {
  static projectSessionActivity(input: SessionActivityInput): ClientSharedNotificationIntent | undefined {
    if (input.activity.type === 'tool.approval_requested') {
      return {
        key: [
          'session-approval',
          input.workspaceId ?? 'default-workspace',
          input.sessionId,
          input.activity.call.id,
        ].join(':'),
        title: 'Approval required',
        body: `Waiting for ${ClientSharedSessionActivityService.formatToolLabel(input.activity)}`,
        tone: 'warning',
        timestamp: input.activity.timestamp,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        runId: input.activity.runId,
      };
    }

    if (input.activity.type === 'loop.finished') {
      return {
        key: [
          'session-run-finished',
          input.workspaceId ?? 'default-workspace',
          input.sessionId,
          input.activity.runId,
        ].join(':'),
        title: 'Session run finished',
        body: input.activity.summary || input.activity.outcome,
        tone: ClientSharedSessionActivityService.resolveRunOutcomeTone(input.activity.outcome),
        timestamp: input.activity.timestamp,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        runId: input.activity.runId,
      };
    }

    return undefined;
  }

  static projectHeartbeatEnvelope(input: HeartbeatEnvelopeInput): ClientSharedNotificationIntent | undefined {
    if (input.envelope.type !== 'heartbeat.event') {
      return undefined;
    }

    const { event } = input.envelope;
    if (!('taskId' in event)) {
      return undefined;
    }

    if (event.type === 'heartbeat.task.finished') {
      const taskName = event.record.task.name || event.taskId;
      return {
        key: [
          'heartbeat-task-finished',
          input.workspaceId ?? input.envelope.workspaceId,
          event.taskId,
          event.record.runId,
        ].join(':'),
        title: 'Task run finished',
        body: `${taskName}: ${event.record.task.state.progress ?? event.record.task.state.status}`,
        tone: event.record.task.state.status === 'failed' ? 'error' : 'success',
        timestamp: event.timestamp,
        workspaceId: input.workspaceId ?? input.envelope.workspaceId,
        taskId: event.taskId,
        runId: event.record.runId,
      };
    }

    if (event.type === 'heartbeat.task.failed') {
      return {
        key: [
          'heartbeat-task-failed',
          input.workspaceId ?? input.envelope.workspaceId,
          event.taskId,
          event.timestamp,
        ].join(':'),
        title: 'Task run failed',
        body: event.error,
        tone: 'error',
        timestamp: event.timestamp,
        workspaceId: input.workspaceId ?? input.envelope.workspaceId,
        taskId: event.taskId,
      };
    }

    return undefined;
  }
}

/**
 * Tracks delivered notification keys for one host session so reconnects,
 * cache invalidations, and fallback polling do not repeatedly notify users for
 * the same approval or run completion.
 */
export class ClientSharedNotificationMemory {
  private readonly seenKeys: string[] = [];
  private readonly seen = new Set<string>();
  private readonly maxSeenKeys: number;

  constructor(options: NotificationMemoryOptions = {}) {
    this.maxSeenKeys = options.maxSeenKeys ?? DEFAULT_MAX_SEEN_KEYS;
  }

  accept(intent: ClientSharedNotificationIntent | undefined): ClientSharedNotificationIntent | undefined {
    if (!intent || this.seen.has(intent.key)) {
      return undefined;
    }

    this.seen.add(intent.key);
    this.seenKeys.push(intent.key);
    this.trim();
    return intent;
  }

  private trim(): void {
    while (this.seenKeys.length > this.maxSeenKeys) {
      const removed = this.seenKeys.shift();
      if (removed) {
        this.seen.delete(removed);
      }
    }
  }
}
