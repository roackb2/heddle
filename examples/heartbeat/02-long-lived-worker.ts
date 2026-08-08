/**
 * Stage 02: a long-lived scheduler worker with awaited graceful shutdown.
 *
 * Heddle owns scheduler admission, execution claims, checkpoints, and
 * claim-fenced settlement. This worker process owns its lifetime and signal
 * handling. The built-in file store is suitable for one Node.js process;
 * distributed workers need a store with atomic claims and lease recovery.
 *
 * Run after building this package: yarn example:heartbeat:worker
 */
import { join } from 'node:path';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatTask,
} from '@roackb2/heddle/advanced';

const stateRoot = join(process.cwd(), '.heddle', 'examples', 'heartbeat-worker');
const store = new FileHeartbeatTaskService({ stateRoot });
const task: HeartbeatTask = {
  id: 'long-lived-worker',
  name: 'Long-lived heartbeat worker',
  task: 'Perform one bounded maintenance cycle when due, then report whether follow-up work remains.',
  enabled: true,
  schedule: { intervalMs: 60_000, nextRunAt: new Date().toISOString() },
  runtime: {
    model: process.env.HEDDLE_EXAMPLE_MODEL ?? 'gpt-5.1-codex-mini',
    maxSteps: 2,
    workspaceRoot: process.cwd(),
  },
};
await store.saveTask(task);

const scheduler = HeartbeatSchedulerService.start({
  workspaceRoot: process.cwd(),
  stateRoot,
  store,
  pollIntervalMs: 30_000,
  maxSteps: 2,
  onError: (error) => console.error('Heartbeat scheduler error:', error),
});

let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= scheduler.stop({ cancelRunning: true });
  return stopping;
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop();
  });
}

console.log(`Heartbeat worker started. State: ${stateRoot}`);
await new Promise<void>((resolve) => {
  const waitForStop = () => {
    if (stopping) {
      void stopping.finally(resolve);
      return;
    }
    setTimeout(waitForStop, 100);
  };
  waitForStop();
});

// Next: 03-domain-handler.ts adds host-owned claim and acknowledgement logic
// while leaving Heddle's runtime credentials and execution persistence inside Heddle.
