import { resolve } from 'node:path';
import { Command } from 'commander';
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
  ): Promise<
    | { kind: 'help' }
    | { kind: 'attached'; host: ResolvedRuntimeHost }
    | { kind: 'started'; handle: HeddleControlPlaneServerHandle }
  > {
    if (hasHelpFlag(args)) {
      (options.stdout ?? process.stdout).write(`${renderDaemonHelp()}\n`);
      return {
        kind: 'help',
      };
    }

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
  let parsed: DaemonArgs | undefined;
  buildDaemonCommand((args) => {
    parsed = args;
  }).parse(args, { from: 'user' });

  return parsed ?? defaultDaemonArgs();
}

export function renderDaemonHelp(): string {
  return buildDaemonCommand(() => {}).helpInformation().trimEnd();
}

function buildDaemonCommand(onParsed: (args: DaemonArgs) => void): Command {
  return new Command()
    .name('heddle daemon')
    .description('Start the local Heddle daemon and browser control plane')
    .exitOverride()
    .showHelpAfterError()
    .option('--host <host>', 'host to bind', DEFAULT_HOST)
    .option('--port <port>', 'port to bind', (value) => parsePort(value), DEFAULT_PORT)
    .option('--assets-dir <path>', 'serve browser assets from this directory')
    .option('--no-assets', 'disable static browser asset serving')
    .action((flags: DaemonCommandFlags) => {
      onParsed({
        host: flags.host,
        port: flags.port,
        assetsDir: flags.assetsDir ? resolve(flags.assetsDir) : undefined,
        serveAssets: flags.assets !== false,
      });
    });
}

type DaemonCommandFlags = {
  host: string;
  port: number;
  assetsDir?: string;
  assets?: boolean;
};

function defaultDaemonArgs(): DaemonArgs {
  return {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    serveAssets: true,
  };
}

function parsePort(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0 || value > 65_535) {
    throw new Error(`Invalid daemon port: ${raw}`);
  }
  return value;
}

function hasHelpFlag(args: string[]): boolean {
  return args.some((arg) => arg === '--help' || arg === '-h');
}
