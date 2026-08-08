/**
 * Stage 05: one targeted delivery in an ephemeral worker.
 *
 * The host has already routed one durable task id. Heddle loads and claims
 * only that task, runs the normal claim-fenced settlement pipeline once, and
 * leaves queue retries, visibility, recovery, and domain idempotency to the
 * host. No model request is made by this example.
 *
 * Run after building this package: yarn example:heartbeat:ephemeral
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatTask,
} from '@roackb2/heddle/advanced';

const now = new Date('2026-08-08T06:00:00.000Z');
const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-heartbeat-ephemeral-'));

try {
  const store = new FileHeartbeatTaskService({ stateRoot });
  const tasks = ['ephemeral-a', 'ephemeral-b'].map((id) => ({
    id,
    task: `Process host-owned work for ${id}.`,
    enabled: true,
    schedule: { intervalMs: 60_000, nextRunAt: '2099-01-01T00:00:00.000Z' },
  } satisfies HeartbeatTask));
  await store.reconcileTasks({ namespace: 'ephemeral-', desired: tasks });

  // A durable host inbox or queue would retain the payload separately and
  // deliver only the task id. Both tasks become due, but this worker receives A.
  await Promise.all(tasks.map(async (task) => await store.requestTaskRun(task.id, {
    requestedAt: now,
    reason: 'host-work-arrived',
  })));

  const handledTaskIds: string[] = [];
  const first = await HeartbeatSchedulerService.runTask({
    store,
    taskId: 'ephemeral-a',
    executionOwnerId: 'queue-delivery-001',
    now: () => now,
    handler: async (context) => {
      handledTaskIds.push(context.task.id);
      return context.skip({ summary: 'No model work was needed for this example.' });
    },
  });
  const duplicate = await HeartbeatSchedulerService.runTask({
    store,
    taskId: 'ephemeral-a',
    executionOwnerId: 'queue-delivery-001-duplicate',
    now: () => now,
    handler: async (context) => {
      handledTaskIds.push(context.task.id);
      return context.skip({ summary: 'A duplicate delivery must not run.' });
    },
  });
  const untouched = await store.requireTask('ephemeral-b');

  assert(first.status === 'settled', `expected first delivery to settle, received ${first.status}`);
  assert(duplicate.status === 'not-due', `expected duplicate delivery to be not-due, received ${duplicate.status}`);
  assert(handledTaskIds.join(',') === 'ephemeral-a', 'only the routed task may invoke the handler');
  assert(untouched.state?.execution === undefined, 'targeted execution must not claim another due task');
  assert(untouched.state?.runRequest?.generation === 1, 'unrelated durable work must remain pending');

  console.log(JSON.stringify({
    first: first.status,
    duplicate: duplicate.status,
    handledTaskIds,
    untouchedTask: {
      id: untouched.id,
      pendingGeneration: untouched.state?.runRequest?.generation,
      claimedGeneration: untouched.state?.runRequest?.claimedGeneration,
    },
  }, null, 2));
} finally {
  await rm(stateRoot, { recursive: true, force: true });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
