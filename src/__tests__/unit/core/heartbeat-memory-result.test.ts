import { describe, expect, it } from 'vitest';
import {
  AgentHeartbeatResultSchema,
  HeartbeatTaskRunRecordSchema,
  HeartbeatTaskSchema,
} from '@/core/heartbeat/tasks/schemas.js';

const legacyResult = {
  decision: 'continue',
  summary: 'Historical result without a memory receipt.',
  checkpoint: {
    version: 1,
    runId: 'run-1',
    createdAt: '2026-09-12T00:00:00.000Z',
    state: {
      runId: 'run-1',
      status: 'finished',
      transcript: [],
      trace: [],
    },
  },
  state: {
    runId: 'run-1',
    finishedAt: '2026-09-12T00:00:00.000Z',
    outcome: 'done',
  },
};

describe('AgentHeartbeatResultSchema memory receipt', () => {
  it('decodes a historical result without a receipt as unchanged', () => {
    expect(AgentHeartbeatResultSchema.parse(legacyResult).memory).toEqual({ changed: false });
  });

  it('preserves an explicit changed receipt', () => {
    expect(AgentHeartbeatResultSchema.parse({
      ...legacyResult,
      memory: { changed: true },
    }).memory).toEqual({ changed: true });
  });

  it('applies the compatibility default inside historical task and run records', () => {
    const task = {
      id: 'legacy-task',
      task: 'Continue historical work.',
      enabled: true,
      schedule: { intervalMs: 60_000 },
      state: {
        status: 'waiting',
        resumable: true,
        result: legacyResult,
      },
    };

    expect(HeartbeatTaskSchema.parse(task).state?.result?.memory).toEqual({ changed: false });
    expect(HeartbeatTaskRunRecordSchema.parse({
      task: { ...task, state: undefined },
      result: legacyResult,
      loadedCheckpoint: false,
    }).result?.memory).toEqual({ changed: false });
  });
});
