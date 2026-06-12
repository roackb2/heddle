import { describe, expect, it } from 'vitest';
import {
  ClientSharedNotificationIntentService,
  ClientSharedNotificationMemory,
} from '@/client-shared/services/notifications/index.js';
import type {
  ControlPlaneHeartbeatEventEnvelope,
  ControlPlaneSessionEventEnvelope,
} from '@/client-shared/api/types.js';

type SessionActivity = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.event' }>['activities'][number];

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
      key: 'session-run-finished:workspace-1:session-1:run-1',
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
