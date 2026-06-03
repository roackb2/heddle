import { resolve } from 'node:path';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import type { HeddleControlPlaneServerHandle, HeddleControlPlaneServerOptions } from '@/server/index.js';
import { createServerLogger, startHeddleControlPlaneServer } from '@/server/index.js';

const DEFAULT_CONTROL_PLANE_HOST = '127.0.0.1';
const DEFAULT_CONTROL_PLANE_PORT = 8765;

export type ControlPlaneCommandRuntimeInput = {
  workspaceRoot: string;
  stateDir: string;
  preferApiKey: boolean;
  runtimeHost: ResolvedRuntimeHost;
  forceOwnerConflict: boolean;
};

export type ControlPlaneCommandRuntime = {
  kind: 'attached' | 'embedded';
  trpcUrl: string;
  endpoint: {
    host: string;
    port: number;
  };
  serverId: string;
  close: () => Promise<void>;
};

type ControlPlaneCommandRuntimeDependencies = {
  startServer?: (options: HeddleControlPlaneServerOptions) => Promise<HeddleControlPlaneServerHandle>;
  createLogger?: (stateRoot: string) => HeddleControlPlaneServerOptions['logger'];
};

/**
 * Owns command-edge control-plane transport bootstrap.
 *
 * Runtime commands attach to a live server when available, or start an embedded
 * control-plane server when needed. After this bootstrap step, commands should
 * use the shared control-plane API rather than core runtime services.
 */
export class ControlPlaneCommandRuntimeService {
  static async resolve(
    input: ControlPlaneCommandRuntimeInput,
    dependencies: ControlPlaneCommandRuntimeDependencies = {},
  ): Promise<ControlPlaneCommandRuntime> {
    if (!input.forceOwnerConflict && input.runtimeHost.kind === 'server' && !input.runtimeHost.stale) {
      return {
        kind: 'attached',
        trpcUrl: ControlPlaneCommandRuntimeService.buildTrpcUrl(input.runtimeHost.endpoint),
        endpoint: input.runtimeHost.endpoint,
        serverId: input.runtimeHost.serverId,
        close: async () => undefined,
      };
    }

    const startServer = dependencies.startServer ?? startHeddleControlPlaneServer;
    const stateRoot = resolve(input.workspaceRoot, input.stateDir);
    const logger = dependencies.createLogger?.(stateRoot) ?? createServerLogger({
      stateRoot,
      console: false,
    });
    const handle = await startServer({
      mode: 'embedded-chat',
      workspaceRoot: input.workspaceRoot,
      stateRoot,
      preferApiKey: input.preferApiKey,
      host: DEFAULT_CONTROL_PLANE_HOST,
      port: DEFAULT_CONTROL_PLANE_PORT,
      logger,
    });

    return {
      kind: 'embedded',
      trpcUrl: ControlPlaneCommandRuntimeService.buildTrpcUrl(handle.endpoint),
      endpoint: handle.endpoint,
      serverId: handle.serverId,
      close: handle.close,
    };
  }

  static formatNotice(runtime: ControlPlaneCommandRuntime, surface: string): string {
    if (runtime.kind === 'attached') {
      return [
        `Heddle notice: attaching ${surface} to the live control-plane server.`,
        `server=http://${runtime.endpoint.host}:${runtime.endpoint.port}`,
        `serverId=${runtime.serverId}`,
      ].join(' ');
    }

    return [
      `Heddle notice: started embedded ${surface} control-plane server.`,
      `server=http://${runtime.endpoint.host}:${runtime.endpoint.port}`,
      `browser=http://${runtime.endpoint.host}:${runtime.endpoint.port}`,
      `serverId=${runtime.serverId}`,
    ].join(' ');
  }

  static installEmbeddedShutdown(runtime: ControlPlaneCommandRuntime, label: string): () => void {
    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      runtime.close()
        .catch((error) => {
          process.stderr.write(`Heddle embedded ${label} server failed during ${signal} shutdown: ${String(error)}\n`);
          process.exitCode = 1;
        })
        .finally(() => {
          process.exit();
        });
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    return () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
    };
  }

  private static buildTrpcUrl(endpoint: { host: string; port: number }): string {
    return `http://${endpoint.host}:${endpoint.port}/trpc`;
  }
}
