/**
 * Stage 01: one durable heartbeat cycle.
 *
 * Heddle owns the task checkpoint, agent cycle, execution record, and provider
 * credential resolution. This process owns where its local state directory
 * lives and when the single cycle runs. It is a one-process example: the
 * built-in file store is not a multi-worker or cross-process lease service.
 *
 * Run after building this package: yarn example:heartbeat:one-cycle
 */
import { join } from 'node:path';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatTask,
} from '@roackb2/heddle/advanced';

const stateRoot = join(process.cwd(), '.heddle', 'examples', 'heartbeat-one-cycle');
const task: HeartbeatTask = {
  id: 'one-cycle',
  name: 'One-cycle heartbeat example',
  task: 'Inspect the available work and make one bounded, safe progress update. Pause if there is no useful work.',
  enabled: true,
  schedule: { intervalMs: 60_000, nextRunAt: new Date().toISOString() },
  runtime: {
    model: process.env.HEDDLE_EXAMPLE_MODEL ?? 'gpt-5.1-codex-mini',
    maxSteps: 2,
    workspaceRoot: process.cwd(),
  },
};

const store = new FileHeartbeatTaskService({ stateRoot });
await store.reconcileTasks({ namespace: 'one-cycle', desired: [task] });

const result = await HeartbeatSchedulerService.runDueTasks({
  store,
  runtime: { workspaceRoot: process.cwd(), stateDir: stateRoot, maxSteps: 2 },
});

console.log({ checked: result.checked, ran: result.ran, failed: result.failed, stateRoot });

// Next: 02-long-lived-worker.ts keeps the scheduler alive and shuts it down
// only after its active work has settled.
