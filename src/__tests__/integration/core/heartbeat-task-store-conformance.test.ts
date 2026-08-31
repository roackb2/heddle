import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileHeartbeatTaskService } from '../../../core/heartbeat/tasks/service.js';
import {
  HeartbeatTaskStoreConformance,
  HeartbeatTaskStoreConformanceError,
  type HeartbeatTaskStoreConformanceHarness,
} from '../../../heartbeat-testing.js';
import type {
  HeartbeatTargetedTaskStore,
  HeartbeatTaskExecution,
} from '../../../core/heartbeat/tasks/types.js';

describe('HeartbeatTaskStoreConformance', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'heddle-heartbeat-store-conformance-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const harness: HeartbeatTaskStoreConformanceHarness = {
    createStore: (namespace) => new FileHeartbeatTaskService({ dir: join(root, namespace) }),
    createAdmissionControl: (namespace) => new FileHeartbeatTaskService({ dir: join(root, namespace) }),
    cleanupNamespace: async (namespace) => await rm(join(root, namespace), { recursive: true, force: true }),
    now: () => new Date('2026-08-08T00:00:00.000Z'),
    makeExecutionRecoverable: async ({ store, task, execution }) => {
      await store.saveTask({
        ...task,
        state: { ...task.state, status: 'running', execution },
      });
    },
    capabilities: { runRequestSubscription: true, runHistory: true },
  };

  const scenarios = HeartbeatTaskStoreConformance.createScenarios(harness);

  it('publishes eight uniquely named scenarios', () => {
    expect(scenarios).toHaveLength(8);
    expect(new Set(scenarios.map((scenario) => scenario.name)).size).toBe(8);
  });

  it.each(scenarios)('$name', async ({ run }) => {
    await run();
  });

  it('rejects an adapter that ignores atomic due-claim eligibility', async () => {
    const brokenHarness: HeartbeatTaskStoreConformanceHarness = {
      ...harness,
      createStore: async (namespace) => ignoreDueClaimMode(await harness.createStore(namespace)),
    };
    const targetedScenario = HeartbeatTaskStoreConformance.createScenarios(brokenHarness)
      .find((scenario) => scenario.name.includes('due claims'));

    expect(targetedScenario).toBeDefined();
    await expect(targetedScenario?.run()).rejects.toBeInstanceOf(HeartbeatTaskStoreConformanceError);
  });

  it('rejects an adapter that accepts stale settlement writes', async () => {
    const brokenHarness: HeartbeatTaskStoreConformanceHarness = {
      ...harness,
      createStore: async (namespace) => ignoreExecutionFencing(await harness.createStore(namespace)),
    };
    const recoveryScenario = HeartbeatTaskStoreConformance.createScenarios(brokenHarness)
      .find((scenario) => scenario.name.includes('stale settlement'));

    expect(recoveryScenario).toBeDefined();
    await expect(recoveryScenario?.run()).rejects.toBeInstanceOf(HeartbeatTaskStoreConformanceError);
  });

  it('rejects an adapter that reports success without atomically persisting settlement', async () => {
    const brokenHarness: HeartbeatTaskStoreConformanceHarness = {
      ...harness,
      createStore: async (namespace) => discardSuccessfulSettlement(await harness.createStore(namespace)),
    };
    const settlementScenario = HeartbeatTaskStoreConformance.createScenarios(brokenHarness)
      .find((scenario) => scenario.name.includes('settle atomically'));

    expect(settlementScenario).toBeDefined();
    await expect(settlementScenario?.run()).rejects.toBeInstanceOf(HeartbeatTaskStoreConformanceError);
  });

  it('rejects an adapter that ignores assigned admission groups', async () => {
    const brokenHarness: HeartbeatTaskStoreConformanceHarness = {
      ...harness,
      createStore: async (namespace) => discardAdmissionGroup(await harness.createStore(namespace)),
    };
    const admissionScenario = HeartbeatTaskStoreConformance.createScenarios(brokenHarness)
      .find((scenario) => scenario.name.includes('admission changes linearize'));

    expect(admissionScenario).toBeDefined();
    await expect(admissionScenario?.run()).rejects.toBeInstanceOf(HeartbeatTaskStoreConformanceError);
  });
});

function ignoreDueClaimMode(store: HeartbeatTargetedTaskStore): HeartbeatTargetedTaskStore {
  return new Proxy(store, {
    get(target, property) {
      if (property === 'claimTaskExecution') {
        return async (input: Parameters<HeartbeatTargetedTaskStore['claimTaskExecution']>[0]) =>
          await target.claimTaskExecution({ ...input, claimMode: 'any' });
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) as unknown : value;
    },
  });
}

function ignoreExecutionFencing(store: HeartbeatTargetedTaskStore): HeartbeatTargetedTaskStore {
  return new Proxy(store, {
    get(target, property) {
      if (property === 'completeTaskExecution') {
        return async (input: Parameters<HeartbeatTargetedTaskStore['completeTaskExecution']>[0]) =>
          await target.completeTaskExecution({ ...input, execution: await currentExecution(target, input.taskId, input.execution) });
      }
      if (property === 'failTaskExecution') {
        return async (input: Parameters<HeartbeatTargetedTaskStore['failTaskExecution']>[0]) =>
          await target.failTaskExecution({ ...input, execution: await currentExecution(target, input.taskId, input.execution) });
      }
      if (property === 'recordTaskExecutionOutcome') {
        return async (input: Parameters<HeartbeatTargetedTaskStore['recordTaskExecutionOutcome']>[0]) =>
          await target.recordTaskExecutionOutcome({ ...input, execution: await currentExecution(target, input.taskId, input.execution) });
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) as unknown : value;
    },
  });
}

function discardSuccessfulSettlement(store: HeartbeatTargetedTaskStore): HeartbeatTargetedTaskStore {
  return new Proxy(store, {
    get(target, property) {
      if (property === 'completeTaskExecution') {
        return async (input: Parameters<HeartbeatTargetedTaskStore['completeTaskExecution']>[0]) => {
          const task = await target.loadTask(input.taskId);
          if (!task) return { status: 'claim-lost' } as const;
          return {
            status: 'saved',
            task,
            record: {
              task,
              result: input.result,
              loadedCheckpoint: input.loadedCheckpoint,
            },
          } as const;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) as unknown : value;
    },
  });
}

function discardAdmissionGroup(store: HeartbeatTargetedTaskStore): HeartbeatTargetedTaskStore {
  return new Proxy(store, {
    get(target, property) {
      if (property === 'saveTask') {
        return async (task: Parameters<HeartbeatTargetedTaskStore['saveTask']>[0]) => {
          const ungrouped = { ...task };
          delete ungrouped.admissionGroupId;
          await target.saveTask(ungrouped);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) as unknown : value;
    },
  });
}

async function currentExecution(
  store: HeartbeatTargetedTaskStore,
  taskId: string,
  fallback: HeartbeatTaskExecution,
): Promise<HeartbeatTaskExecution> {
  return (await store.loadTask(taskId))?.state?.execution ?? fallback;
}
