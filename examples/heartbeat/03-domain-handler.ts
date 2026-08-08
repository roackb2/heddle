/**
 * Stage 03: a custom handler for host-owned domain work.
 *
 * Heddle owns the execution identity, credentials, agent loop, checkpoint,
 * abort signal, and durable result. The host owns claiming work, validating
 * its own postcondition, and acknowledging the external record. The file
 * store remains a one-process topology; use a transactional remote store for
 * multiple workers.
 *
 * Run after building this package: yarn example:heartbeat:domain-handler
 * Set HEDDLE_EXAMPLE_NO_WORK=true to take the deterministic no-model skip path.
 */
import { join } from 'node:path';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatTask,
  type HeartbeatTaskHandler,
} from '@roackb2/heddle/advanced';

type ClaimedWork = { id: string; instruction: string; status: 'claimed' };

const stateRoot = join(process.cwd(), '.heddle', 'examples', 'heartbeat-domain-handler');
const store = new FileHeartbeatTaskService({ stateRoot });
await store.saveTask({
  id: 'domain-handler',
  name: 'Domain handler heartbeat',
  task: 'Complete the host-claimed work with the host-provided constraints.',
  enabled: true,
  schedule: { intervalMs: 60_000, nextRunAt: new Date().toISOString() },
  runtime: { model: process.env.HEDDLE_EXAMPLE_MODEL ?? 'gpt-5.1-codex-mini', maxSteps: 2, workspaceRoot: process.cwd() },
} satisfies HeartbeatTask);

const handler: HeartbeatTaskHandler = async (context) => {
  const claim = claimWork();
  if (!claim) {
    return context.skip({ summary: 'The host found no eligible work.' });
  }

  const result = await context.runAgent({
    task: `${context.task.task}\n\nClaimed work: ${claim.instruction}`,
    systemContext: `Operate only on host claim ${claim.id}.`,
    includeDefaultTools: false,
    maxSteps: 2,
  });

  assertClaimCanBeAcknowledged(claim);
  acknowledgeWork(claim, result.summary);
  return result;
};

const result = await HeartbeatSchedulerService.runDueTasks({
  store,
  runtime: { workspaceRoot: process.cwd(), stateDir: stateRoot, maxSteps: 2 },
  handler,
});
console.log({ checked: result.checked, ran: result.ran, failed: result.failed, stateRoot });

function claimWork(): ClaimedWork | undefined {
  if (process.env.HEDDLE_EXAMPLE_NO_WORK === 'true') {
    return undefined;
  }
  return { id: 'work-001', instruction: 'Summarize the safe action taken for this claimed work item.', status: 'claimed' };
}

function assertClaimCanBeAcknowledged(claim: ClaimedWork): void {
  if (claim.status !== 'claimed') {
    throw new Error(`Host claim ${claim.id} is no longer eligible for acknowledgement.`);
  }
}

function acknowledgeWork(claim: ClaimedWork, summary: string): void {
  console.log(`[host] acknowledged ${claim.id}: ${summary.split('\n')[0] ?? ''}`);
}

// Next: 04-event-driven-wake.ts keeps event payload in the host and uses a
// durable Heddle run request only as a coalescible wake-up signal.
