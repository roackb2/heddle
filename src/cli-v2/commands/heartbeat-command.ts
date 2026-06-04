import type { ParsedHeartbeatArgs } from './heartbeat/args.js';
import { parseHeartbeatArgs, renderHeartbeatHelp, stringFlag } from './heartbeat/args.js';
import { parseDurationMs } from './heartbeat/duration.js';
import { runHeartbeatRunsCli } from './heartbeat/run-commands.js';
import { runHeartbeatTaskCli } from './heartbeat/task-commands.js';
import { runHeartbeatWorkerCli, startHeartbeatCli } from './heartbeat/worker.js';
import type { HeartbeatCliOptions } from './heartbeat/types.js';
import { ClientSharedProxyApiService } from '@/client-shared/api/proxy.js';
import { ControlPlaneCommandRuntimeService } from './control-plane-command-runtime.js';

export type { HeartbeatCliOptions } from './heartbeat/types.js';
export { parseHeartbeatArgs, renderHeartbeatHelp } from './heartbeat/args.js';
export { formatDurationMs, parseDurationMs } from './heartbeat/duration.js';

/**
 * Command edge for `heddle heartbeat`.
 *
 * Owns: terminal heartbeat subcommand parsing, control-plane attach/embed
 * bootstrap, scheduler bootstrap flags for `start`, and terminal output
 * dispatch.
 *
 * Does not own: heartbeat task mutation policy, run execution, scheduler
 * recurrence, or run storage. Those are handled by control-plane APIs and the
 * heartbeat server/core services.
 */
export class HeartbeatCliCommandEdgeService {
  static async run(args: string[], options: HeartbeatCliOptions = {}) {
    if (shouldRenderHeartbeatHelp(args)) {
      process.stdout.write(`${renderHeartbeatHelp(args)}\n`);
      return;
    }

    const parsed = parseHeartbeatArgs(args);
    const heartbeatScheduler = HeartbeatCliCommandEdgeService.resolveHeartbeatScheduler(parsed);
    const runtime = await ControlPlaneCommandRuntimeService.resolve({
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      stateDir: options.stateDir ?? '.heddle',
      preferApiKey: Boolean(options.preferApiKey),
      runtimeHost: options.runtimeHost ?? { kind: 'none', registryPath: '' },
      forceOwnerConflict: Boolean(options.forceOwnerConflict),
      heartbeatScheduler,
    });
    const uninstallRuntimeShutdown =
      runtime.kind === 'embedded' ? ControlPlaneCommandRuntimeService.installEmbeddedShutdown(runtime, 'heartbeat') : () => undefined;

    try {
      process.stdout.write(`${ControlPlaneCommandRuntimeService.formatNotice(runtime, 'heartbeat')}\n`);
      if (runtime.kind === 'attached' && heartbeatScheduler.enabled && stringFlag(parsed.flags, 'poll')) {
        throw new Error('--poll only applies when heartbeat start launches an embedded control-plane server.');
      }

      const context = {
        client: ClientSharedProxyApiService.createClient({ url: runtime.trpcUrl }),
        workspaceId: options.activeWorkspaceId ?? 'default',
        options,
      };

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

  private static resolveHeartbeatScheduler(parsed: ParsedHeartbeatArgs): {
    enabled?: boolean;
    pollIntervalMs?: number;
  } {
    if (parsed.command !== 'start' || parsed.flags.once) {
      return { enabled: false };
    }

    const poll = stringFlag(parsed.flags, 'poll');
    return {
      enabled: true,
      pollIntervalMs: poll ? parseDurationMs(poll) : undefined,
    };
  }
}

function shouldRenderHeartbeatHelp(args: string[]): boolean {
  return !args.length || args[0] === 'help' || args.some((arg) => arg === '--help' || arg === '-h');
}
