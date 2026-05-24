import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeddleServerApp } from './app.js';
import { controlPlaneHeartbeatEventsController } from './controllers/trpc/control-plane/heartbeat-events.js';
import { HeddleHeartbeatSchedulerHost } from './heartbeat-scheduler-host.js';
import { createServerLogger } from './logger.js';
import { assertWebAssetsBuilt } from './static.js';
import type { HeddleServerListenOptions } from './types.js';
import type { HeartbeatSchedulerEvent } from '@/core/heartbeat/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';

export type { HeddleServerListenOptions, HeddleServerOptions } from './types.js';
export { appRouter, type AppRouter } from './router.js';
export { createHeddleServerApp } from './app.js';
export { createServerLogger } from './logger.js';
export { ControlPlaneChatSessionPresenter } from './controllers/trpc/control-plane/chat-session-presenter.js';

export async function listenHeddleDaemon(options: HeddleServerListenOptions): Promise<void> {
  const serveAssets = options.serveAssets !== false;
  const assetsDir = serveAssets ? (options.assetsDir ?? resolveDefaultAssetsDir()) : undefined;
  if (assetsDir) {
    assertWebAssetsBuilt(assetsDir);
  }
  const logger = options.logger ?? createServerLogger({ stateRoot: options.stateRoot });
  const registryPath = options.daemonRegistryPath ?? FileDaemonRegistryRepository.resolvePath();
  const ownerId = `daemon-${process.pid}-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const registerDaemon = (lastSeenAt?: string) => {
    const workspaceContext = RuntimeWorkspaceService.resolveContext({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    });
    RuntimeDaemonRegistryService.upsertWorkspaceRegistration({
      registryPath,
      workspaces: workspaceContext.workspaces,
      owner: {
        ownerId,
        mode: 'daemon',
        host: options.host,
        port: options.port,
        pid: process.pid,
        startedAt,
        lastSeenAt,
        workspaceRoot: options.workspaceRoot,
        stateRoot: options.stateRoot,
      },
    });
  };
  const unregisterDaemon = () => {
    const workspaceContext = RuntimeWorkspaceService.resolveContext({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    });
    RuntimeDaemonRegistryService.clearWorkspaceRegistration({
      registryPath,
      workspaceIds: workspaceContext.workspaces.map((workspace) => workspace.id),
      stateRoots: workspaceContext.workspaces.map((workspace) => workspace.stateRoot),
      ownerId,
    });
  };

  registerDaemon(startedAt);
  const heartbeatSchedulerHost = new HeddleHeartbeatSchedulerHost({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    preferApiKey: options.preferApiKey,
    onEvent: (workspace, event) => {
      logDaemonHeartbeatSchedulerEvent(logger, workspace, event);
      controlPlaneHeartbeatEventsController.publish({
        workspaceId: workspace.id,
        event,
      });
    },
    onError: (workspace, error) => logger.error({ error, workspace }, 'Daemon heartbeat scheduler stopped unexpectedly'),
  });
  heartbeatSchedulerHost.start();

  const app = createHeddleServerApp({
    ...options,
    assetsDir,
    serveAssets,
    logger,
    runtimeHost: {
      mode: 'daemon',
      ownerId,
      registryPath,
      endpoint: {
        host: options.host,
        port: options.port,
      },
      startedAt,
    },
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    unregisterDaemon();
  };

  const heartbeat = setInterval(() => {
    try {
      registerDaemon();
      heartbeatSchedulerHost.sync();
    } catch (error) {
      logger.warn({ error }, 'Failed to refresh daemon registry heartbeat');
    }
  }, 15000);
  heartbeat.unref?.();

  let server: Server | undefined;
  let shuttingDown = false;
  const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(heartbeat);
    heartbeatSchedulerHost.stop();
    cleanup();

    if (!server) {
      process.exit(0);
      return;
    }

    server.close((error) => {
      if (error) {
        logger.error({ error, signal }, 'Heddle server failed during shutdown');
        process.exitCode = 1;
      }
      process.exit();
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await new Promise<void>((resolveListen, rejectListen) => {
    const listeningServer = app.listen(options.port, options.host, () => {
      listeningServer.off('error', rejectListen);
      listeningServer.once('close', () => {
        clearInterval(heartbeat);
        heartbeatSchedulerHost.stop();
        cleanup();
      });
      logger.info({
        host: options.host,
        port: options.port,
        workspaceRoot: options.workspaceRoot,
        stateRoot: options.stateRoot,
        assetsDir,
        serveAssets,
        registryPath,
        ownerId,
      }, 'Heddle server started');
      process.stdout.write(`Heddle server listening at http://${options.host}:${options.port}\n`);
      process.stdout.write(`workspace=${options.workspaceRoot}\n`);
      process.stdout.write(`state=${options.stateRoot}\n`);
      process.stdout.write(`registry=${registryPath}\n`);
      resolveListen();
    });
    server = listeningServer;
    listeningServer.once('error', (error) => {
      clearInterval(heartbeat);
      heartbeatSchedulerHost.stop();
      cleanup();
      logger.error({ error }, 'Heddle server failed');
      rejectListen(error);
    });
  });
}

export const listenHeddleServer = listenHeddleDaemon;

function logDaemonHeartbeatSchedulerEvent(
  logger: ReturnType<typeof createServerLogger>,
  workspace: WorkspaceDescriptor,
  event: HeartbeatSchedulerEvent,
) {
  const messages = {
    'heartbeat.scheduler.started': 'Daemon heartbeat scheduler started',
    'heartbeat.scheduler.stopped': 'Daemon heartbeat scheduler stopped',
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
    resolve(moduleDir, '../web'),
    resolve(moduleDir, '../../web'),
    resolve(moduleDir, '../../../src/web'),
  ];

  for (const candidate of candidates) {
    const indexPath = resolve(candidate, 'index.html');
    if (existsSync(indexPath)) {
      return candidate;
    }
  }

  return candidates[0];
}
