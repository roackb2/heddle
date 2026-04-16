// ---------------------------------------------------------------------------
// Example: Heartbeat Scheduler
//
// Usage:
//   OPENAI_API_KEY=sk-... yarn example:heartbeat-scheduler
//
// Optional:
//   HEDDLE_EXAMPLE_MODEL=claude-3-5-haiku-latest ANTHROPIC_API_KEY=sk-ant-... yarn example:heartbeat-scheduler
//
// This demonstrates Heddle's local-first scheduler API. It creates or updates
// one durable heartbeat task under .heddle/examples/heartbeat-scheduler/, runs
// due tasks once, and persists task/checkpoint/run state for the next wake.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { inferProviderFromModel } from '../src/core/llm/providers.js';
import { resolveProviderApiKey } from '../src/core/runtime/api-keys.js';
import {
  createFileHeartbeatTaskStore,
  runDueHeartbeatTasks,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
} from '../src/core/runtime/heartbeat-scheduler.js';

const DEFAULT_EXAMPLE_MODEL = 'gpt-5.1-codex-mini';
const STORE_DIR = join(process.cwd(), '.heddle', 'examples', 'heartbeat-scheduler');
const TASK_ID = 'demo-maintenance';

async function main() {
  const model = process.env.HEDDLE_EXAMPLE_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_EXAMPLE_MODEL;
  const provider = inferProviderFromModel(model);
  const apiKey = resolveProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${provider}. ` +
      'Set OPENAI_API_KEY for OpenAI models or ANTHROPIC_API_KEY for Claude models before running this example.',
    );
  }

  const store = createFileHeartbeatTaskStore({ dir: STORE_DIR });
  await ensureDemoTask(store, model);

  const result = await runDueHeartbeatTasks({
    store,
    now: () => new Date(),
    heartbeat: {
      apiKey,
      tools: [],
      includeDefaultTools: false,
      workspaceRoot: process.cwd(),
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

async function ensureDemoTask(
  store: ReturnType<typeof createFileHeartbeatTaskStore>,
  model: string,
) {
  const existing = (await store.listTasks()).find((task) => task.id === TASK_ID);
  const task: HeartbeatTask = {
    ...(existing ?? {}),
    id: TASK_ID,
    name: 'Demo maintenance heartbeat',
    task:
      'Check whether there is useful autonomous maintenance work to do for this demo. No tools are available in this scheduler example. If no useful work is available, explain that the task should pause.',
    enabled: true,
    intervalMs: 60_000,
    nextRunAt: new Date(Date.now() - 1_000).toISOString(),
    model,
    maxSteps: 2,
    workspaceRoot: process.cwd(),
  };

  await store.saveTask(task);
}

function formatSchedulerEvent(event: HeartbeatSchedulerEvent): string | undefined {
  switch (event.type) {
    case 'heartbeat.task.due':
      return `[event] task.due id=${event.taskId}`;
    case 'heartbeat.task.started':
      return `[event] task.started id=${event.taskId} loadedCheckpoint=${event.loadedCheckpoint}`;
    case 'heartbeat.task.finished':
      return `[event] task.finished id=${event.taskId} decision=${event.decision} enabled=${event.enabled} nextRunAt=${event.nextRunAt ?? 'none'}`;
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
