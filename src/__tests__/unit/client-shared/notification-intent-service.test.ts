import { describe, expect, it } from 'vitest';
import {
  ClientSharedNotificationIntentService,
  ClientSharedNotificationMemory,
} from '@/client-shared/services/notifications/index.js';
import type {
  ControlPlaneHeartbeatEventEnvelope,
  ControlPlaneSessionRunEventEnvelope,
} from '@/client-shared/api/types.js';

type SessionActivity = Extract<ControlPlaneSessionRunEventEnvelope, { kind: 'activity' }>['activity'];

describe('ClientSharedNotificationIntentService', () => {
  it('projects approval and run-finished session activities with stable keys', () => {
    const approval = ClientSharedNotificationIntentService.projectSessionActivity({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      activity: {
        source: 'agent-loop',
        type: 'tool.approval_requested',
        runId: 'run-1',
        step: 2,
        call: {
          id: 'call-1',
          tool: 'run_shell_mutate',
          input: { command: 'yarn test' },
        },
        derived: {
          kind: 'tool-summary',
          summary: 'yarn test',
        },
        timestamp: '2026-06-12T00:00:00.000Z',
      } as SessionActivity,
    });
    const finished = ClientSharedNotificationIntentService.projectSessionActivity({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      activity: {
        source: 'agent-loop',
        type: 'loop.finished',
        runId: 'run-1',
        outcome: 'done',
        summary: 'All set.',
        timestamp: '2026-06-12T00:01:00.000Z',
      } as SessionActivity,
    });

    expect(approval).toMatchObject({
      key: 'session-approval:workspace-1:session-1:call-1',
      title: 'Approval required',
      body: 'Waiting for yarn test',
      tone: 'warning',
    });
    expect(finished).toMatchObject({
      key: 'session-run-terminal:workspace-1:session-1:run-1',
      title: 'Session run finished',
      body: 'All set.',
      tone: 'success',
    });
  });

  it('projects heartbeat completion and failure events', () => {
    const finished = ClientSharedNotificationIntentService.projectHeartbeatEnvelope({
      workspaceId: 'workspace-1',
      envelope: {
        type: 'heartbeat.event',
        workspaceId: 'workspace-1',
        timestamp: '2026-06-12T00:02:00.000Z',
        event: {
          type: 'heartbeat.task.finished',
          taskId: 'task-1',
          timestamp: '2026-06-12T00:02:00.000Z',
          record: {
            id: 'record-1',
            taskId: 'task-1',
            workspaceId: 'workspace-1',
            runId: 'run-2',
            createdAt: '2026-06-12T00:02:00.000Z',
            loadedCheckpoint: false,
            result: {
              decision: 'complete',
              summary: 'Done.',
              outcome: 'complete',
            },
            task: {
              id: 'task-1',
              taskId: 'task-1',
              workspaceId: 'workspace-1',
              name: 'Repo gardener',
              task: 'Check repo',
              enabled: true,
              schedule: { intervalMs: 60000 },
              state: {
                status: 'complete',
                progress: 'Heartbeat task completed.',
              },
            },
          },
        },
      } as ControlPlaneHeartbeatEventEnvelope,
    });
    const failed = ClientSharedNotificationIntentService.projectHeartbeatEnvelope({
      workspaceId: 'workspace-1',
      envelope: {
        type: 'heartbeat.event',
        workspaceId: 'workspace-1',
        timestamp: '2026-06-12T00:03:00.000Z',
        event: {
          type: 'heartbeat.task.failed',
          taskId: 'task-1',
          error: 'boom',
          status: 'failed',
          progress: 'boom',
          timestamp: '2026-06-12T00:03:00.000Z',
        },
      } as ControlPlaneHeartbeatEventEnvelope,
    });

    expect(finished).toMatchObject({
      key: 'heartbeat-task-finished:workspace-1:task-1:run-2',
      title: 'Task run finished',
      body: 'Repo gardener: Heartbeat task completed.',
      tone: 'success',
    });
    expect(failed).toMatchObject({
      key: 'heartbeat-task-failed:workspace-1:task-1:2026-06-12T00:03:00.000Z',
      title: 'Task run failed',
      body: 'boom',
      tone: 'error',
    });
  });

  it('projects run terminals and durable approval signals without activity duplication', () => {
    const terminal = ClientSharedNotificationIntentService.projectSessionRunTerminal({
      workspaceId: 'workspace-1',
      envelope: {
        type: 'session.run.terminal',
        sessionId: 'session-1',
        timestamp: '2026-06-12T00:01:00.000Z',
        terminal: {
          kind: 'error',
          runId: 'run-1',
          sequence: 3,
          timestamp: '2026-06-12T00:01:00.000Z',
          error: { code: 'run_failed', message: 'boom' },
        },
      },
    });
    const approval = ClientSharedNotificationIntentService.projectSessionApproval({
      workspaceId: 'workspace-1',
      envelope: {
        type: 'session.approval.updated',
        sessionId: 'session-1',
        timestamp: '2026-06-12T00:00:00.000Z',
        approval: {
          tool: 'run_shell_mutate',
          callId: 'call-1',
          input: { command: 'yarn test' },
          requestedAt: '2026-06-12T00:00:00.000Z',
        },
      },
    });

    expect(terminal).toMatchObject({
      key: 'session-run-terminal:workspace-1:session-1:run-1',
      title: 'Session run failed',
      body: 'boom',
      tone: 'error',
    });
    expect(approval).toMatchObject({
      key: 'session-approval:workspace-1:session-1:call-1',
      title: 'Approval required',
      body: 'Waiting for run shell mutate',
      tone: 'warning',
    });
  });

  it('projects long session results as concise notification previews', () => {
    const longSummary = [
      'I inspected the workspace and found the next implementation slice.',
      '',
      'This detail is intentionally repeated so the durable conversation keeps the complete answer. '.repeat(5),
    ].join('\n');
    const activity = ClientSharedNotificationIntentService.projectSessionActivity({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      activity: {
        source: 'agent-loop',
        type: 'loop.finished',
        runId: 'run-1',
        outcome: 'done',
        summary: longSummary,
        timestamp: '2026-06-12T00:01:00.000Z',
      } as SessionActivity,
    });
    const terminal = ClientSharedNotificationIntentService.projectSessionRunTerminal({
      workspaceId: 'workspace-1',
      envelope: {
        type: 'session.run.terminal',
        sessionId: 'session-1',
        timestamp: '2026-06-12T00:01:00.000Z',
        terminal: {
          kind: 'result',
          runId: 'run-1',
          sequence: 3,
          timestamp: '2026-06-12T00:01:00.000Z',
          result: { outcome: 'done', summary: longSummary },
        },
      },
    });

    expect(activity?.body).toBe(terminal.body);
    expect(activity?.body).toHaveLength(160);
    expect(activity?.body).not.toContain('\n');
    expect(activity?.body).toMatch(/…$/);
  });

  it('deduplicates notification intents by key', () => {
    const memory = new ClientSharedNotificationMemory();
    const intent = {
      key: 'same-key',
      title: 'Approval required',
      tone: 'warning',
      timestamp: '2026-06-12T00:00:00.000Z',
    } as const;

    expect(memory.accept(intent)).toEqual(intent);
    expect(memory.accept(intent)).toBeUndefined();
  });
});
