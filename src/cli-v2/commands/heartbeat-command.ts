import { parseHeartbeatArgs } from './heartbeat/args.js';
import { printHeartbeatHelp } from './heartbeat/output.js';
import { runHeartbeatRunsCli } from './heartbeat/run-commands.js';
import { runHeartbeatTaskCli } from './heartbeat/task-commands.js';
import { runHeartbeatWorkerCli, startHeartbeatCli } from './heartbeat/worker.js';
import type { HeartbeatCliOptions } from './heartbeat/types.js';
import { ClientSharedProxyApiService } from '@/client-shared/api/proxy.js';
import { ControlPlaneCommandRuntimeService } from './control-plane-command-runtime.js';

export type { HeartbeatCliOptions } from './heartbeat/types.js';
export { parseHeartbeatArgs } from './heartbeat/args.js';
export { formatDurationMs, parseDurationMs } from './heartbeat/duration.js';

export async function runHeartbeatCli(args: string[], options: HeartbeatCliOptions = {}) {
  const parsed = parseHeartbeatArgs(args);

  if (!parsed.command || parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
    printHeartbeatHelp();
    return;
  }

  const runtime = await ControlPlaneCommandRuntimeService.resolve({
    workspaceRoot: options.workspaceRoot ?? process.cwd(),
    stateDir: options.stateDir ?? '.heddle',
    preferApiKey: Boolean(options.preferApiKey),
    runtimeHost: options.runtimeHost ?? { kind: 'none', registryPath: '' },
    forceOwnerConflict: Boolean(options.forceOwnerConflict),
  });
  process.stdout.write(`${ControlPlaneCommandRuntimeService.formatNotice(runtime, 'heartbeat')}\n`);
  const context = {
    client: ClientSharedProxyApiService.createClient({ url: runtime.trpcUrl }),
    workspaceId: options.activeWorkspaceId ?? 'default',
    options,
  };

  const uninstallRuntimeShutdown =
    runtime.kind === 'embedded' ? ControlPlaneCommandRuntimeService.installEmbeddedShutdown(runtime, 'heartbeat') : () => undefined;

  try {
    if (parsed.command === 'task') {
      await runHeartbeatTaskCli(parsed, context);
      return;
    }

    if (parsed.command === 'run') {
      await runHeartbeatWorkerCli(parsed, context);
      return;
    }

    if (parsed.command === 'runs') {
      await runHeartbeatRunsCli(parsed, context);
      return;
    }

    if (parsed.command === 'start') {
      await startHeartbeatCli(parsed, context);
      if (runtime.kind === 'embedded' && !parsed.flags.once) {
        process.stdout.write('Embedded heartbeat server running. Press Ctrl+C to stop.\n');
        await new Promise(() => undefined);
      }
      return;
    }

    throw new Error(`Unknown heartbeat command: ${parsed.command}`);
  } finally {
    uninstallRuntimeShutdown();
    await runtime.close();
  }
}
