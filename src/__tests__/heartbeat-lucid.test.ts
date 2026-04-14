import { describe, expect, it } from 'vitest';
import {
  heartbeatSchedulerEventToLucidMessages,
  heartbeatRunViewToLucidMessages,
  heartbeatTaskStatusToLucidStatus,
  heartbeatTaskViewToLucidMessages,
  type HeartbeatRunView,
  type HeartbeatTaskView,
} from '../index.js';

describe('heartbeat Lucid adapter', () => {
  it('maps heartbeat task states into Lucid-style agent statuses', () => {
    expect(heartbeatTaskStatusToLucidStatus('running')).toBe('running');
    expect(heartbeatTaskStatusToLucidStatus('waiting')).toBe('asleep');
    expect(heartbeatTaskStatusToLucidStatus('idle')).toBe('asleep');
    expect(heartbeatTaskStatusToLucidStatus('complete')).toBe('terminated');
    expect(heartbeatTaskStatusToLucidStatus('blocked')).toBe('blocked');
    expect(heartbeatTaskStatusToLucidStatus('failed')).toBe('failed');
  });

  it('projects a task view into Lucid-style status, progress, and response messages', () => {
    const messages = heartbeatTaskViewToLucidMessages(createTaskView(), {
      taskIdToAgentId: (taskId) => `agent:${taskId}`,
    });

    expect(messages).toEqual([
      {
        event: 'agent_status',
        data: {
          status: {
            agent_id: 'agent:repo-check',
            status: 'asleep',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
      {
        event: 'agent_progress',
        data: {
          progress: {
            agent_id: 'agent:repo-check',
            progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
      {
        event: 'agent_response',
        data: {
          response: {
            agent_id: 'agent:repo-check',
            response: 'Repository check complete.',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
    ]);
  });

  it('projects a run view into Lucid-style messages', () => {
    const messages = heartbeatRunViewToLucidMessages(createRunView());

    expect(messages).toEqual([
      {
        event: 'agent_status',
        data: {
          status: {
            agent_id: 'repo-check',
            status: 'asleep',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
      {
        event: 'agent_progress',
        data: {
          progress: {
            agent_id: 'repo-check',
            progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
      {
        event: 'agent_response',
        data: {
          response: {
            agent_id: 'repo-check',
            response: 'Repository check complete.',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
    ]);
  });

  it('converts scheduler events into Lucid-style incremental notifications', () => {
    const started = heartbeatSchedulerEventToLucidMessages({
      type: 'heartbeat.task.started',
      taskId: 'repo-check',
      loadedCheckpoint: true,
      status: 'running',
      progress: 'Resuming heartbeat wake from the last checkpoint.',
      timestamp: '2026-04-14T00:00:00.000Z',
    });

    expect(started).toEqual([
      {
        event: 'agent_status',
        data: {
          status: {
            agent_id: 'repo-check',
            status: 'running',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
      {
        event: 'agent_progress',
        data: {
          progress: {
            agent_id: 'repo-check',
            progress: 'Resuming heartbeat wake from the last checkpoint.',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
    ]);

    const finished = heartbeatSchedulerEventToLucidMessages({
      type: 'heartbeat.task.finished',
      taskId: 'repo-check',
      decision: 'continue',
      outcome: 'done',
      status: 'waiting',
      progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
      summary: 'Repository check complete.',
      runId: 'run_1',
      enabled: true,
      nextRunAt: '2026-04-14T00:01:00.000Z',
      timestamp: '2026-04-14T00:00:00.000Z',
    });

    expect(finished.at(-1)).toEqual({
      event: 'agent_response',
      data: {
        response: {
          agent_id: 'repo-check',
          response: 'Repository check complete.',
          timestamp: '2026-04-14T00:00:00.000Z',
        },
      },
    });

    const failed = heartbeatSchedulerEventToLucidMessages({
      type: 'heartbeat.task.failed',
      taskId: 'repo-check',
      error: 'temporary failure',
      status: 'failed',
      progress: 'Heartbeat wake failed and will retry later.',
      nextRunAt: '2026-04-14T00:05:00.000Z',
      timestamp: '2026-04-14T00:00:00.000Z',
    });

    expect(failed).toEqual([
      {
        event: 'agent_status',
        data: {
          status: {
            agent_id: 'repo-check',
            status: 'failed',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
      {
        event: 'agent_progress',
        data: {
          progress: {
            agent_id: 'repo-check',
            progress: 'Heartbeat wake failed and will retry later. Error: temporary failure',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
    ]);
  });
});

function createTaskView(): HeartbeatTaskView {
  return {
    taskId: 'repo-check',
    task: 'Inspect repo state',
    enabled: true,
    status: 'waiting',
    decision: 'continue',
    outcome: 'done',
    progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
    summary: 'Repository check complete.',
    nextRunAt: '2026-04-14T00:01:00.000Z',
    lastRunAt: '2026-04-14T00:00:00.000Z',
    lastRunId: 'run_1',
    loadedCheckpoint: true,
    resumable: true,
    intervalMs: 60_000,
  };
}

function createRunView(): HeartbeatRunView {
  return {
    id: '2026-04-14T00-00-00.000Z-repo-check',
    taskId: 'repo-check',
    runId: 'run_1',
    createdAt: '2026-04-14T00:00:00.000Z',
    task: 'Inspect repo state',
    enabled: true,
    status: 'waiting',
    decision: 'continue',
    outcome: 'done',
    progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
    summary: 'Repository check complete.',
    loadedCheckpoint: true,
    resumable: true,
  };
}
