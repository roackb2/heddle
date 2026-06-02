import { resolve } from 'node:path';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import type { HeddleControlPlaneServerHandle, HeddleControlPlaneServerOptions } from '@/server/index.js';
import { startHeddleControlPlaneServer } from '@/server/index.js';
import { startChatCliV2 } from '../index.js';

const DEFAULT_CONTROL_PLANE_HOST = '127.0.0.1';
const EMBEDDED_CONTROL_PLANE_PORT = 0;

export type ChatCliV2CommandOptions = {
  workspaceRoot: string;
  activeWorkspaceId: string;
  model?: string;
  maxSteps?: number;
  preferApiKey: boolean;
  stateDir: string;
  searchIgnoreDirs: string[];
  systemContext?: string;
  runtimeHost: ResolvedRuntimeHost;
  forceOwnerConflict: boolean;
};

export type ChatV2RuntimeInput = {
  workspaceRoot: string;
  stateDir: string;
  preferApiKey: boolean;
  runtimeHost: ResolvedRuntimeHost;
  forceOwnerConflict: boolean;
};

export type ChatV2Runtime = {
  kind: 'attached' | 'embedded';
  trpcUrl: string;
  endpoint: {
    host: string;
    port: number;
  };
  serverId: string;
  close: () => Promise<void>;
};

type ChatV2RuntimeDependencies = {
  startServer?: (options: HeddleControlPlaneServerOptions) => Promise<HeddleControlPlaneServerHandle>;
};

export async function runChatCliV2Command(options: ChatCliV2CommandOptions): Promise<void> {
  const runtime = await resolveChatV2Runtime(options);
  process.stdout.write(`${formatChatV2RuntimeNotice(runtime)}\n`);
  const uninstallRuntimeShutdown =
    runtime.kind === 'embedded' ? installChatV2EmbeddedRuntimeShutdown(runtime) : () => undefined;
  const app = startChatCliV2({
    trpcUrl: runtime.trpcUrl,
    workspaceId: options.activeWorkspaceId,
    model: options.model,
    maxSteps: options.maxSteps,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext: options.systemContext,
    preferApiKey: options.preferApiKey,
  });
  try {
    await app.waitUntilExit();
  } finally {
    uninstallRuntimeShutdown();
    await runtime.close();
  }
}

export async function resolveChatV2Runtime(
  input: ChatV2RuntimeInput,
  dependencies: ChatV2RuntimeDependencies = {},
): Promise<ChatV2Runtime> {
  if (!input.forceOwnerConflict && input.runtimeHost.kind === 'server' && !input.runtimeHost.stale) {
    return {
      kind: 'attached',
      trpcUrl: buildTrpcUrl(input.runtimeHost.endpoint),
      endpoint: input.runtimeHost.endpoint,
      serverId: input.runtimeHost.serverId,
      close: async () => undefined,
    };
  }

  const startServer = dependencies.startServer ?? startHeddleControlPlaneServer;
  const handle = await startServer({
    mode: 'embedded-chat',
    workspaceRoot: input.workspaceRoot,
    stateRoot: resolve(input.workspaceRoot, input.stateDir),
    preferApiKey: input.preferApiKey,
    host: DEFAULT_CONTROL_PLANE_HOST,
    port: EMBEDDED_CONTROL_PLANE_PORT,
    serveAssets: false,
  });

  return {
    kind: 'embedded',
    trpcUrl: buildTrpcUrl(handle.endpoint),
    endpoint: handle.endpoint,
    serverId: handle.serverId,
    close: handle.close,
  };
}

export function formatChatV2RuntimeNotice(runtime: ChatV2Runtime): string {
  if (runtime.kind === 'attached') {
    return [
      'Heddle notice: attaching chat-v2 to the live control-plane server.',
      `server=http://${runtime.endpoint.host}:${runtime.endpoint.port}`,
      `serverId=${runtime.serverId}`,
    ].join(' ');
  }

  return [
    'Heddle notice: started embedded chat-v2 control-plane server.',
    `server=http://${runtime.endpoint.host}:${runtime.endpoint.port}`,
    `serverId=${runtime.serverId}`,
  ].join(' ');
}

export function installChatV2EmbeddedRuntimeShutdown(runtime: ChatV2Runtime): () => void {
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    runtime.close()
      .catch((error) => {
        process.stderr.write(`Heddle embedded chat-v2 server failed during ${signal} shutdown: ${String(error)}\n`);
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

function buildTrpcUrl(endpoint: { host: string; port: number }): string {
  return `http://${endpoint.host}:${endpoint.port}/trpc`;
}
