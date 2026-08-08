/**
 * Stage 04: event-driven durable wake-up with host-owned event payload.
 *
 * Heddle persists only the task's request generation and bounded wake reason;
 * this host retains the event payload and decides how to consume it. In one
 * process the file store notifies the scheduler promptly. Across processes,
 * polling remains the correctness fallback; a distributed topology needs a
 * transactional store plus its own payload delivery and idempotency design.
 *
 * Run after building this package: yarn example:heartbeat:events
 */
import { join } from 'node:path';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatTask,
  type HeartbeatTaskHandler,
} from '@roackb2/heddle/advanced';

type IncomingEvent = { id: string; instruction: string };

const stateRoot = join(process.cwd(), '.heddle', 'examples', 'heartbeat-event-wake');
const store = new FileHeartbeatTaskService({ stateRoot });
const pendingEvents = new Map<string, IncomingEvent>();
await store.saveTask({
  id: 'event-driven-work',
  name: 'Event-driven heartbeat',
  task: 'Process one host-provided event safely and report the result.',
  enabled: true,
  schedule: { intervalMs: 60_000, nextRunAt: '2099-01-01T00:00:00.000Z' },
  runtime: { model: process.env.HEDDLE_EXAMPLE_MODEL ?? 'gpt-5.1-codex-mini', maxSteps: 2, workspaceRoot: process.cwd() },
} satisfies HeartbeatTask);

const handler: HeartbeatTaskHandler = async (context) => {
  const event = pendingEvents.values().next().value as IncomingEvent | undefined;
  if (!event) {
    return context.skip({ summary: 'No host event remained after the coalesced wake-up.' });
  }
  pendingEvents.delete(event.id);

  return await context.runAgent({
    task: `${context.task.task}\n\nHost event: ${event.instruction}`,
    systemContext: `Operate only on host event ${event.id}.`,
    includeDefaultTools: false,
    maxSteps: 2,
  });
};

const scheduler = HeartbeatSchedulerService.start({
  workspaceRoot: process.cwd(),
  stateRoot,
  store,
  pollIntervalMs: 60_000,
  maxSteps: 2,
  handler,
  onError: (error) => console.error('Heartbeat scheduler error:', error),
});

async function onHostEvent(event: IncomingEvent): Promise<void> {
  pendingEvents.set(event.id, event); // Payload stays in the host's data boundary.
  await store.requestTaskRun('event-driven-work', { reason: 'host-event-arrived' });
}

await Promise.all([
  onHostEvent({ id: 'event-001', instruction: 'Review the first newly available work item.' }),
  onHostEvent({ id: 'event-002', instruction: 'Review the second newly available work item.' }),
]);

console.log(`Event-driven scheduler started. State: ${stateRoot}`);
process.once('SIGINT', () => void scheduler.stop({ cancelRunning: true }));
process.once('SIGTERM', () => void scheduler.stop({ cancelRunning: true }));

// Next: keep the payload store and its idempotency keys host-owned. Move to a
// custom heartbeat store only when its atomic claims, fenced settlement, and
// recovery leases are designed for the intended multi-worker topology.
