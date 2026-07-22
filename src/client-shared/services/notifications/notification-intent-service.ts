import {
  ClientSharedSessionActivityService,
} from '@/client-shared/services/session-activities/index.js';
import truncate from 'lodash/truncate.js';
import type {
  ClientSharedHeartbeatEventEnvelope,
  ClientSharedNotificationIntent,
  ClientSharedSessionApprovalEnvelope,
  ClientSharedSessionNotificationActivity,
  ClientSharedSessionRunTerminalEnvelope,
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

type SessionRunTerminalInput = {
  workspaceId?: string;
  envelope: ClientSharedSessionRunTerminalEnvelope;
};

type SessionApprovalInput = {
  workspaceId?: string;
  envelope: ClientSharedSessionApprovalEnvelope;
};

type NotificationMemoryOptions = {
  maxSeenKeys?: number;
};

const DEFAULT_MAX_SEEN_KEYS = 200;
const SESSION_COMPLETION_PREVIEW_LENGTH = 160;

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
          'session-run-terminal',
          input.workspaceId ?? 'default-workspace',
          input.sessionId,
          input.activity.runId,
        ].join(':'),
        title: 'Session run finished',
        body: projectSessionCompletionPreview(input.activity.summary, input.activity.outcome),
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

  static projectSessionRunTerminal(input: SessionRunTerminalInput): ClientSharedNotificationIntent {
    const terminal = input.envelope.terminal;
    const presentation = projectRunTerminalPresentation(terminal);

    return {
      key: [
        'session-run-terminal',
        input.workspaceId ?? 'default-workspace',
        input.envelope.sessionId,
        terminal.runId,
      ].join(':'),
      ...presentation,
      timestamp: terminal.timestamp,
      workspaceId: input.workspaceId,
      sessionId: input.envelope.sessionId,
      runId: terminal.runId,
    };
  }

  static projectSessionApproval(input: SessionApprovalInput): ClientSharedNotificationIntent | undefined {
    const approval = input.envelope.approval;
    if (!approval) {
      return undefined;
    }

    return {
      key: [
        'session-approval',
        input.workspaceId ?? 'default-workspace',
        input.envelope.sessionId,
        approval.callId,
      ].join(':'),
      title: 'Approval required',
      body: `Waiting for ${approval.tool.replaceAll('_', ' ')}`,
      tone: 'warning',
      timestamp: approval.requestedAt,
      workspaceId: input.workspaceId,
      sessionId: input.envelope.sessionId,
    };
  }
}

function projectRunTerminalPresentation(
  terminal: ClientSharedSessionRunTerminalEnvelope['terminal'],
): Pick<ClientSharedNotificationIntent, 'title' | 'body' | 'tone'> {
  if (terminal.kind === 'error') {
    return { title: 'Session run failed', body: terminal.error.message, tone: 'error' };
  }
  if (terminal.kind === 'cancelled') {
    return { title: 'Session run cancelled', body: terminal.reason, tone: 'warning' };
  }
  return {
    title: 'Session run finished',
    body: projectSessionCompletionPreview(terminal.result.summary, terminal.result.outcome),
    tone: 'success',
  };
}

function projectSessionCompletionPreview(summary: string | undefined, outcome: string | undefined): string {
  const content = (summary?.trim() || outcome?.trim() || 'Completed').replace(/\s+/g, ' ');
  return truncate(content, {
    length: SESSION_COMPLETION_PREVIEW_LENGTH,
    omission: '…',
  });
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
