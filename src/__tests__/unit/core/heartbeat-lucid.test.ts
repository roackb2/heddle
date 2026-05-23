import { describe, expect, it } from 'vitest';
import {
  HeartbeatLucidPresenter,
  type AgentHeartbeatResult,
  type AgentLoopState,
  type HeartbeatRunView,
  type HeartbeatSchedulerEvent,
  type HeartbeatTaskView,
} from '../../../index.js';

describe('heartbeat Lucid adapter', () => {
  it('maps heartbeat task states into Lucid-style agent statuses', () => {
    expect(HeartbeatLucidPresenter.taskStatusToLucidStatus('running')).toBe('running');
    expect(HeartbeatLucidPresenter.taskStatusToLucidStatus('waiting')).toBe('asleep');
    expect(HeartbeatLucidPresenter.taskStatusToLucidStatus('idle')).toBe('asleep');
    expect(HeartbeatLucidPresenter.taskStatusToLucidStatus('complete')).toBe('terminated');
    expect(HeartbeatLucidPresenter.taskStatusToLucidStatus('blocked')).toBe('blocked');
    expect(HeartbeatLucidPresenter.taskStatusToLucidStatus('failed')).toBe('failed');
  });

  it('projects a task view into Lucid-style status, progress, and response messages', () => {
    const messages = HeartbeatLucidPresenter.taskViewToMessages(createTaskView(), {
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
            progress: 'Heartbeat runner finished. Waiting until the next scheduled run in 1m.',
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
    const messages = HeartbeatLucidPresenter.runViewToMessages(createRunView());

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
            progress: 'Heartbeat runner finished. Waiting until the next scheduled run in 1m.',
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
    const started = HeartbeatLucidPresenter.schedulerEventToMessages({
      type: 'heartbeat.task.started',
      taskId: 'repo-check',
      loadedCheckpoint: true,
      status: 'running',
      progress: 'Resuming heartbeat runner from the last checkpoint.',
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
            progress: 'Resuming heartbeat runner from the last checkpoint.',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
    ]);

    const finished = HeartbeatLucidPresenter.schedulerEventToMessages({
      type: 'heartbeat.task.finished',
      taskId: 'repo-check',
      record: createFinishedRecord(),
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

    const failed = HeartbeatLucidPresenter.schedulerEventToMessages({
      type: 'heartbeat.task.failed',
      taskId: 'repo-check',
      error: 'temporary failure',
      status: 'failed',
      progress: 'Heartbeat runner failed and will retry later.',
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
            progress: 'Heartbeat runner failed and will retry later.',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
      {
        event: 'agent_response',
        data: {
          response: {
            agent_id: 'repo-check',
            response: 'temporary failure',
            timestamp: '2026-04-14T00:00:00.000Z',
          },
        },
      },
    ]);
  });
});

function createTaskView(): HeartbeatTaskView {
  return {
    id: 'repo-check',
    taskId: 'repo-check',
    task: 'Inspect repo state',
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2026-04-14T00:01:00.000Z',
    },
    state: {
      status: 'waiting',
      progress: 'Heartbeat runner finished. Waiting until the next scheduled run in 1m.',
      runAt: '2026-04-14T00:00:00.000Z',
      runId: 'run_1',
      loadedCheckpoint: true,
      resumable: true,
      result: createHeartbeatResult(),
    },
  };
}

function createRunView(): HeartbeatRunView {
  return {
    id: '2026-04-14T00-00-00.000Z-repo-check',
    taskId: 'repo-check',
    runId: 'run_1',
    createdAt: '2026-04-14T00:00:00.000Z',
    task: createTaskView(),
    result: {
      decision: 'continue',
      summary: 'Repository check complete.',
      outcome: 'done',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        requests: 1,
      },
    },
    loadedCheckpoint: true,
  };
}

function createFinishedRecord(): Extract<HeartbeatSchedulerEvent, { type: 'heartbeat.task.finished' }>['record'] {
  return {
    task: {
      id: 'repo-check',
      task: 'Inspect repo state',
      enabled: true,
      schedule: {
        intervalMs: 60_000,
        nextRunAt: '2026-04-14T00:01:00.000Z',
      },
      state: {
        status: 'waiting',
        progress: 'Heartbeat runner finished. Waiting until the next scheduled run in 1m.',
        runAt: '2026-04-14T00:00:00.000Z',
        runId: 'run_1',
        loadedCheckpoint: true,
        resumable: true,
        result: createHeartbeatResult(),
      },
    },
    result: createHeartbeatResult(),
    loadedCheckpoint: true,
  };
}

function createHeartbeatResult(): AgentHeartbeatResult {
  const state: AgentLoopState = {
    status: 'finished',
    runId: 'run_1',
    goal: 'Heartbeat runner cycle',
    model: 'gpt-5.1-codex-mini',
    provider: 'openai',
    workspaceRoot: '/tmp/workspace',
    startedAt: '2026-04-13T23:59:00.000Z',
    finishedAt: '2026-04-14T00:00:00.000Z',
    outcome: 'done',
    summary: 'Repository check complete.',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      requests: 1,
    },
    transcript: [],
    trace: [],
  };

  return {
    decision: 'continue',
    summary: 'Repository check complete.',
    checkpoint: {
      version: 1,
      runId: 'run_1',
      createdAt: '2026-04-14T00:00:00.000Z',
      state,
    },
    state,
  };
}
