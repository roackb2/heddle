import { watch } from 'node:fs';
import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createServerLogger } from './logger.js';
import { createRequestLoggingMiddleware } from './middleware/request-logging.js';
import { appRouter } from './router.js';
import { installWebStaticRoutes } from './static.js';
import type { HeddleRuntimeHostDescriptor, HeddleServerContext } from './types.js';
import { resolveChatSessionFilePath, subscribeToControlPlaneSessionEvents } from './features/control-plane/services/chat-sessions.js';
import { readDaemonWorkspaceRegistration } from '../core/runtime/daemon-registry.js';
import { resolveWorkspaceContext } from '../core/runtime/workspaces.js';

export function createHeddleServerApp(
  options: Omit<HeddleServerContext, 'logger' | 'activeWorkspaceId' | 'activeWorkspace' | 'workspaces' | 'runtimeHost'>
    & Partial<Pick<HeddleServerContext, 'logger'>>
    & { runtimeHost?: HeddleRuntimeHostDescriptor | null }
    & { assetsDir?: string },
): express.Express {
  const logger = options.logger ?? createServerLogger({ stateRoot: options.stateRoot });
  const app = express();
  app.disable('x-powered-by');
  app.use(createRequestLoggingMiddleware(logger));

  app.use('/trpc', createExpressMiddleware({
    router: appRouter,
    createContext: () => {
      const workspaceContext = resolveWorkspaceContext({
        workspaceRoot: options.workspaceRoot,
        stateRoot: options.stateRoot,
      });
      const workspaceOwner =
        options.runtimeHost ?
          readDaemonWorkspaceRegistration(options.runtimeHost.registryPath, workspaceContext.activeWorkspaceId)?.owner ?? null
        : null;
      return {
        workspaceRoot: options.workspaceRoot,
        stateRoot: options.stateRoot,
        activeWorkspaceId: workspaceContext.activeWorkspaceId,
        activeWorkspace: workspaceContext.activeWorkspace,
        workspaces: workspaceContext.workspaces,
        runtimeHost:
          options.runtimeHost ?
            {
              ...options.runtimeHost,
              workspaceOwner,
            }
          : null,
        logger,
      };
    },
    onError: ({ error, path, type }) => {
      logger.error({
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack,
        },
        path,
        type,
      }, 'tRPC request failed');
    },
  }));

  app.get('/control-plane/sessions/:sessionId/events', (request, response) => {
    const sessionId = typeof request.params.sessionId === 'string' ? request.params.sessionId.trim() : '';
    if (!sessionId) {
      response.status(400).json({ error: 'Missing sessionId' });
      return;
    }

    const workspaceContext = resolveWorkspaceContext({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    });
    const sessionFilePath = resolveChatSessionFilePath(workspaceContext.activeWorkspace.stateRoot, sessionId);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    const send = (event: string, data: Record<string, unknown>) => {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send('ready', { sessionId });
    const heartbeat = setInterval(() => {
      send('heartbeat', { sessionId, timestamp: new Date().toISOString() });
    }, 15000);

    const unsubscribe = subscribeToControlPlaneSessionEvents(sessionId, (payload) => {
      send('session.event', payload);
    });

    let watcher: ReturnType<typeof watch> | undefined;
    try {
      watcher = watch(sessionFilePath, { persistent: false }, () => {
        send('session.updated', { sessionId, timestamp: new Date().toISOString() });
      });
    } catch {
      send('waiting', { sessionId, timestamp: new Date().toISOString() });
    }

    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      watcher?.close();
      response.end();
    });
  });

  if (options.assetsDir) {
    installWebStaticRoutes(app, options.assetsDir);
  }

  return app;
}
