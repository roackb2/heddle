import { resolve } from 'node:path';
import {
  ControlPlaneChatSessionPresenter,
  startHeddleControlPlaneServer,
} from '@/server/index.js';
import type { HeddleControlPlaneServerHandle, HeddleControlPlaneServerOptions } from '@/server/index.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import { RuntimeHostResolver } from '@/core/runtime/daemon/index.js';

export type DaemonCliOptions = {
  workspaceRoot?: string;
  stateDir?: string;
  preferApiKey?: boolean;
  forceOwnerConflict?: boolean;
  runtimeHost?: ResolvedRuntimeHost;
  stdout?: {
    write: (message: string) => unknown;
  };
};

export type DaemonArgs = {
  host: string;
  port: number;
  assetsDir?: string;
  serveAssets: boolean;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;

export { ControlPlaneChatSessionPresenter };

/**
 * Command edge for `heddle daemon`.
 *
 * Owns: terminal daemon argument parsing, live-server attach behavior, CLI
 * notices, and process signal handling for a standalone daemon process.
 *
 * Does not own: reusable HTTP server lifecycle, registry persistence, workspace
 * identity, or heartbeat scheduler semantics. Those belong to `src/server` and
 * `src/core/runtime/daemon`.
 */
export class DaemonCliV2CommandEdgeService {
  static async run(
    args: string[],
    options: DaemonCliOptions = {},
  ): Promise<{ kind: 'attached'; host: ResolvedRuntimeHost } | { kind: 'started'; handle: HeddleControlPlaneServerHandle }> {
    const parsed = parseDaemonArgs(args);
    const runtimeHost = options.runtimeHost ?? RuntimeHostResolver.resolveLiveServer();
    if (!options.forceOwnerConflict && runtimeHost.kind === 'server' && !runtimeHost.stale) {
      writeExistingServerNotice(runtimeHost, options.stdout ?? process.stdout);
      return {
        kind: 'attached',
        host: runtimeHost,
      };
    }

    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const stateDir = options.stateDir ?? '.heddle';
    const listenOptions: HeddleControlPlaneServerOptions = {
      mode: 'daemon',
      workspaceRoot,
      stateRoot: resolve(workspaceRoot, stateDir),
      preferApiKey: Boolean(options.preferApiKey),
      host: parsed.host,
      port: parsed.port,
      assetsDir: parsed.assetsDir,
      serveAssets: parsed.serveAssets,
    };

    const handle = await startHeddleControlPlaneServer(listenOptions);
    installDaemonShutdownHandlers(handle);
    writeStartedServerNotice(handle, options.stdout ?? process.stdout);
    return {
      kind: 'started',
      handle,
    };
  }
}

function writeExistingServerNotice(
  host: Extract<ResolvedRuntimeHost, { kind: 'server' }>,
  stdout: NonNullable<DaemonCliOptions['stdout']>,
) {
  stdout.write(`Heddle control-plane server already running at http://${host.endpoint.host}:${host.endpoint.port}\n`);
  stdout.write(`serverId=${host.serverId}\n`);
}

function writeStartedServerNotice(
  handle: HeddleControlPlaneServerHandle,
  stdout: NonNullable<DaemonCliOptions['stdout']>,
) {
  stdout.write(`Heddle server listening at http://${handle.host}:${handle.port}\n`);
  stdout.write(`workspace=${handle.workspaceRoot}\n`);
  stdout.write(`state=${handle.stateRoot}\n`);
  stdout.write(`registry=${handle.registryPath}\n`);
}

function installDaemonShutdownHandlers(handle: HeddleControlPlaneServerHandle) {
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    handle.close()
      .catch((error) => {
        process.stderr.write(`Heddle server failed during ${signal} shutdown: ${String(error)}\n`);
        process.exitCode = 1;
      })
      .finally(() => {
        process.exit();
      });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

export function parseDaemonArgs(args: string[]): DaemonArgs {
  const flags = parseFlags(args);
  return {
    host: stringFlag(flags, 'host') ?? DEFAULT_HOST,
    port: parsePort(stringFlag(flags, 'port')) ?? DEFAULT_PORT,
    assetsDir: stringFlag(flags, 'assets-dir') ? resolve(stringFlag(flags, 'assets-dir')!) : undefined,
    serveAssets: !booleanFlag(flags, 'no-assets'),
  };
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      continue;
    }

    const eqIndex = arg.indexOf('=');
    if (eqIndex > 0) {
      flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      continue;
    }

    const name = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }

    flags[name] = next;
    index++;
  }
  return flags;
}

function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function booleanFlag(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true;
}

function parsePort(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 && value <= 65_535 ? value : undefined;
}
