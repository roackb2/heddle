import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import type { Logger } from 'pino';
import { createHeddleServerApp } from './app.js';
import { controlPlaneHeartbeatEventsController } from './controllers/trpc/control-plane/heartbeat-events.js';
import { HeddleHeartbeatSchedulerHost } from './heartbeat-scheduler-host.js';
import { createServerLogger } from './logging/server-logger.js';
import { getWorkspaceOperationLogger } from './logging/workspace-operation-logger.js';
import { assertWebAssetsBuilt } from './static.js';
import type { HeddleControlPlaneServerHandle, HeddleControlPlaneServerOptions } from './types.js';
import type { HeartbeatSchedulerEvent } from '@/core/heartbeat/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';

const REGISTRY_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Owns the reusable control-plane HTTP server lifecycle.
 *
 * CLI commands and embedded hosts decide when to start or stop a server; this
 * owner starts the shared Express app, records the live server, keeps scheduler
 * state in sync, and cleans up only this server's registry record on close.
 */
export async function startHeddleControlPlaneServer(
  options: HeddleControlPlaneServerOptions,
): Promise<HeddleControlPlaneServerHandle> {
  const serveAssets = options.serveAssets !== false;
  const assetsDir = serveAssets ? (options.assetsDir ?? resolveDefaultAssetsDir()) : undefined;
  if (assetsDir) {
    assertWebAssetsBuilt(assetsDir);
  }

  const logger = options.logger ?? createServerLogger({ stateRoot: options.stateRoot });
  const registryPath = options.daemonRegistryPath ?? FileDaemonRegistryRepository.resolvePath();
  const serverId = options.serverId ?? `${options.mode}-${process.pid}-${Date.now()}`;
  const startedAt = dayjs().toISOString();
  const heartbeatSchedulerHost = createHeartbeatSchedulerHost(options);

  const endpoint = {
    host: options.host,
    port: options.port,
  };

  const app = createHeddleServerApp({
    ...options,
    assetsDir,
    serveAssets,
    logger,
    runtimeHost: {
      mode: options.mode,
      serverId,
      registryPath,
      endpoint,
      startedAt,
    },
  });

  let cleanedUp = false;
  const lifecycleTimers: { heartbeat?: NodeJS.Timeout } = {};
  const registerServer = (lastSeenAt?: string) => {
    const workspaceContext = RuntimeWorkspaceService.resolveContext({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    });
    RuntimeDaemonRegistryService.registerKnownWorkspaces({
      registryPath,
      workspaces: workspaceContext.workspaces,
    });
    RuntimeDaemonRegistryService.registerLiveServer({
      registryPath,
      server: {
        serverId,
        mode: options.mode,
        host: endpoint.host,
        port: endpoint.port,
        pid: process.pid,
        startedAt,
        lastSeenAt,
      },
    });
  };
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    if (lifecycleTimers.heartbeat) {
      clearInterval(lifecycleTimers.heartbeat);
    }
    heartbeatSchedulerHost.stop();
    RuntimeDaemonRegistryService.clearLiveServer({
      registryPath,
      serverId,
    });
  };

  const server = await listen(app, options.host, options.port);
  endpoint.port = resolveListeningPort(server, options.port);
  server.once('close', cleanup);
  server.on('error', (error) => {
    logger.error({ error, serverId }, 'Heddle server emitted an error');
  });

  try {
    registerServer(startedAt);
    heartbeatSchedulerHost.start();
  } catch (error) {
    await closeServer(server).catch((closeError) => {
      logger.error({ error: closeError, serverId }, 'Failed to close Heddle server after startup error');
    });
    throw error;
  }

  lifecycleTimers.heartbeat = setInterval(() => {
    try {
      registerServer();
      heartbeatSchedulerHost.sync();
    } catch (error) {
      logger.warn({ error }, 'Failed to refresh Heddle server registry heartbeat');
    }
  }, REGISTRY_HEARTBEAT_INTERVAL_MS);
  lifecycleTimers.heartbeat.unref?.();

  let closePromise: Promise<void> | undefined;
  const close = () => {
    closePromise ??= closeServer(server).then(() => {
      cleanup();
    });
    return closePromise;
  };

  logger.info({
    host: endpoint.host,
    port: endpoint.port,
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    assetsDir,
    serveAssets,
    registryPath,
    serverId,
    mode: options.mode,
  }, 'Heddle server started');

  return {
    mode: options.mode,
    serverId,
    host: endpoint.host,
    port: endpoint.port,
    endpoint,
    registryPath,
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    startedAt,
    close,
  };
}

function createHeartbeatSchedulerHost(options: HeddleControlPlaneServerOptions): HeddleHeartbeatSchedulerHost {
  return new HeddleHeartbeatSchedulerHost({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    preferApiKey: options.preferApiKey,
    onEvent: (workspace, event) => {
      logHeartbeatSchedulerEvent(getWorkspaceOperationLogger(workspace.stateRoot), workspace, event);
      controlPlaneHeartbeatEventsController.publish({
        workspaceId: workspace.id,
        event,
      });
    },
    onError: (workspace, error) => {
      getWorkspaceOperationLogger(workspace.stateRoot).error({ error, workspace }, 'Heddle heartbeat scheduler stopped unexpectedly');
    },
  });
}

function listen(app: ReturnType<typeof createHeddleServerApp>, host: string, port: number): Promise<Server> {
  return new Promise((resolveListen, rejectListen) => {
    const server = app.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen(server);
    });
    server.once('error', rejectListen);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    if (!server.listening) {
      resolveClose();
      return;
    }

    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

function resolveListeningPort(server: Server, fallbackPort: number): number {
  const address = server.address();
  if (isAddressInfo(address)) {
    return address.port;
  }

  return fallbackPort;
}

function isAddressInfo(address: ReturnType<Server['address']>): address is AddressInfo {
  return typeof address === 'object' && address !== null && 'port' in address;
}

function logHeartbeatSchedulerEvent(
  logger: Logger,
  workspace: WorkspaceDescriptor,
  event: HeartbeatSchedulerEvent,
) {
  const messages = {
    'heartbeat.scheduler.started': 'Heddle heartbeat scheduler started',
    'heartbeat.scheduler.stopped': 'Heddle heartbeat scheduler stopped',
    'heartbeat.task.due': 'Heartbeat task due',
    'heartbeat.task.started': 'Heartbeat task started',
    'heartbeat.task.agent_event': 'Heartbeat task agent event',
    'heartbeat.task.finished': 'Heartbeat task finished',
    'heartbeat.task.failed': 'Heartbeat task failed',
  } satisfies Record<HeartbeatSchedulerEvent['type'], string>;

  if (event.type === 'heartbeat.task.failed') {
    logger.warn({ workspaceId: workspace.id, stateRoot: workspace.stateRoot, event }, messages[event.type]);
    return;
  }

  logger.info({ workspaceId: workspace.id, stateRoot: workspace.stateRoot, event }, messages[event.type]);
}

function resolveDefaultAssetsDir(): string {
  if (process.env.HEDDLE_WEB_DIST) {
    return resolve(process.env.HEDDLE_WEB_DIST);
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, '../web-v2'),
    resolve(moduleDir, '../../web-v2'),
    resolve(moduleDir, '../../../src/web-v2'),
  ];

  for (const candidate of candidates) {
    const indexPath = resolve(candidate, 'index.html');
    if (existsSync(indexPath)) {
      return candidate;
    }
  }

  return candidates[0];
}
