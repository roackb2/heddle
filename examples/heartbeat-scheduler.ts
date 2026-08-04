// ---------------------------------------------------------------------------
// Example: Heartbeat Scheduler
//
// Usage:
//   heddle auth login openai
//   yarn example:heartbeat-scheduler
//
// Optional:
//   OPENAI_API_KEY=sk-... yarn example:heartbeat-scheduler
//   HEDDLE_EXAMPLE_MODEL=claude-3-5-haiku-latest ANTHROPIC_API_KEY=sk-ant-... yarn example:heartbeat-scheduler
//   HEDDLE_EXAMPLE_PREFER_API_KEY=true OPENAI_API_KEY=sk-... yarn example:heartbeat-scheduler
//   HEDDLE_EXAMPLE_NO_WORK=true yarn example:heartbeat-scheduler
//
// This demonstrates Heddle's local-first scheduler API. It creates or updates
// one durable heartbeat task under .heddle/examples/heartbeat-scheduler/, runs
// due tasks once, and persists task/checkpoint/run state for the next run.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
  type HeartbeatTaskRunnerAgentOptions,
  type HeartbeatTaskStore,
} from '../src/core/heartbeat/index.js';

const DEFAULT_EXAMPLE_MODEL = 'gpt-5.1-codex-mini';
const STORE_DIR = join(process.cwd(), '.heddle', 'examples', 'heartbeat-scheduler');
const TASK_ID = 'demo-maintenance';
const domainTools: NonNullable<HeartbeatTaskRunnerAgentOptions['tools']> = [{
  name: 'read_claimed_work',
  description: 'Read the work item already claimed by this example host.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  execute: async () => ({ ok: true, output: 'Review the example scheduler integration and report one improvement.' }),
}];

async function main() {
  const model = process.env.HEDDLE_EXAMPLE_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_EXAMPLE_MODEL;
  const store = new FileHeartbeatTaskService({ dir: STORE_DIR });
  await ensureDemoTask(store, model);

  const result = await HeartbeatSchedulerService.runDueTasks({
    store,
    maxConcurrentTasks: 2,
    now: () => new Date(),
    runtime: {
      model,
      stateDir: '.heddle',
      preferApiKey: process.env.HEDDLE_EXAMPLE_PREFER_API_KEY === 'true',
      tools: [],
      includeDefaultTools: false,
      workspaceRoot: process.cwd(),
    },
    handler: async (context) => {
      const claim = claimDomainWork();
      if (!claim) {
        return context.skip({ summary: 'The host found no domain work to claim.' });
      }

      const agentResult = await context.runAgent({
        task: `${context.task.task}\n\nClaimed work: ${claim.instruction}`,
        systemContext: `Operate only on host claim ${claim.id}.`,
        tools: domainTools,
      });
      acknowledgeDomainWork(claim.id, agentResult.summary);
      return agentResult;
    },
    onEvent: (event) => {
      const line = formatSchedulerEvent(event);
      if (line) {
        console.log(line);
      }
    },
  });

  console.log('\nScheduler result:\n');
  console.log(`checked=${result.checked}`);
  console.log(`ran=${result.ran}`);
  console.log(`failed=${result.failed}`);
  console.log(`store=${STORE_DIR}`);
  process.exit(0);
}

function claimDomainWork(): { id: string; instruction: string } | undefined {
  return process.env.HEDDLE_EXAMPLE_NO_WORK === 'true' ? undefined : {
    id: 'example-claim-1',
    instruction: 'Use the host-provided tool, then summarize the claimed work.',
  };
}

function acknowledgeDomainWork(claimId: string, summary: string): void {
  console.log(`[host] acknowledged claim=${claimId} summary=${summary.split('\n')[0] ?? ''}`);
}

async function ensureDemoTask(
  store: HeartbeatTaskStore,
  model: string,
) {
  const existing = (await store.listTasks()).find((task) => task.id === TASK_ID);
  const task: HeartbeatTask = {
    ...(existing ?? {}),
    id: TASK_ID,
    name: 'Demo maintenance heartbeat',
    task:
      'Check whether there is useful autonomous maintenance work to do for this demo. Use only the host-provided claimed-work tool.',
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: new Date(Date.now() - 1_000).toISOString(),
    },
    runtime: {
      model,
      maxSteps: 2,
      workspaceRoot: process.cwd(),
    },
  };

  await store.saveTask(task);
}

function formatSchedulerEvent(event: HeartbeatSchedulerEvent): string | undefined {
  switch (event.type) {
    case 'heartbeat.scheduler.awakened':
      return `[event] scheduler.awakened tasks=${event.taskIds.join(',')}`;
    case 'heartbeat.task.due':
      return [
        `[event] task.due id=${event.taskId}`,
        event.queuePosition ? `position=${event.queuePosition}` : undefined,
        event.maxConcurrentTasks ? `concurrency=${event.activeTasks ?? 0}/${event.maxConcurrentTasks}` : undefined,
        event.queuedTasks !== undefined ? `queued=${event.queuedTasks}` : undefined,
      ].filter(Boolean).join(' ');
    case 'heartbeat.task.run_requested':
      return `[event] task.run_requested id=${event.taskId} generation=${event.generation} disposition=${event.disposition}`;
    case 'heartbeat.task.run_request_claimed':
      return `[event] task.run_request_claimed id=${event.taskId} generation=${event.generation} execution=${event.executionId}`;
    case 'heartbeat.task.started':
      return `[event] task.started id=${event.taskId} execution=${event.executionId} loadedCheckpoint=${event.loadedCheckpoint}`;
    case 'heartbeat.task.recovered':
      return `[event] task.recovered id=${event.taskId} interruptedExecutionId=${event.interruptedExecutionId} reason=${event.reason}`;
    case 'heartbeat.task.finished':
      return `[event] task.finished id=${event.taskId} decision=${event.record.result.decision} enabled=${event.record.task.enabled} nextRunAt=${event.record.task.schedule.nextRunAt ?? 'none'}`;
    case 'heartbeat.task.skipped':
      return `[event] task.skipped id=${event.taskId} execution=${event.executionId} summary=${event.record.outcome.summary}`;
    case 'heartbeat.task.cancelled':
      return [
        `[event] task.cancelled id=${event.taskId}`,
        `execution=${event.executionId}`,
        `reason=${event.reason ?? 'scheduler-stop'}`,
      ].join(' ');
    case 'heartbeat.task.failed':
      return `[event] task.failed id=${event.taskId} error=${event.error}`;
    default:
      return undefined;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
