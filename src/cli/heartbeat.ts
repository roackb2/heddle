import { parseHeartbeatArgs } from './heartbeat/args.js';
import { createHeartbeatCliStore } from './heartbeat/store.js';
import { printHeartbeatHelp } from './heartbeat/output.js';
import { runHeartbeatRunsCli } from './heartbeat/run-commands.js';
import { runHeartbeatTaskCli } from './heartbeat/task-commands.js';
import { runHeartbeatWorkerCli, startHeartbeatCli } from './heartbeat/worker.js';
import type { HeartbeatCliOptions } from './heartbeat/types.js';

export type { HeartbeatCliOptions } from './heartbeat/types.js';
export { parseHeartbeatArgs } from './heartbeat/args.js';
export { formatDurationMs, parseDurationMs } from './heartbeat/duration.js';

export async function runHeartbeatCli(args: string[], options: HeartbeatCliOptions = {}) {
  const parsed = parseHeartbeatArgs(args);
  const store = createHeartbeatCliStore(options);

  if (!parsed.command || parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
    printHeartbeatHelp();
    return;
  }

  if (parsed.command === 'task') {
    await runHeartbeatTaskCli(parsed, store, options);
    return;
  }

  if (parsed.command === 'run') {
    await runHeartbeatWorkerCli(parsed, store, options);
    return;
  }

  if (parsed.command === 'runs') {
    await runHeartbeatRunsCli(parsed, store);
    return;
  }

  if (parsed.command === 'start') {
    await startHeartbeatCli(parsed, store, options);
    return;
  }

  throw new Error(`Unknown heartbeat command: ${parsed.command}`);
}
