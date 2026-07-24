import express from 'express';
import { HeddleServerRequestAccessService } from './access/index.js';
import { createServerLogger } from './logging/server-logger.js';
import { createWorkspaceRequestLoggingMiddleware } from './middleware/workspace-request-logging.js';
import { createTrpcExpressRouter } from './routes/trpc/trpc.js';
import { installWebStaticRoutes } from './static.js';
import type {
  HeddleRuntimeHostDescriptor,
  HeddleServerAccessControl,
  HeddleServerContext,
} from './types.js';
import { createControlPlaneApiRouter } from './routes/control-plane-apis.js';

export function createHeddleServerApp(
  options: Pick<HeddleServerContext, 'workspaceRoot' | 'stateRoot'>
    & { preferApiKey?: boolean }
    & Partial<Pick<HeddleServerContext, 'logger'>>
    & { runtimeHost?: HeddleRuntimeHostDescriptor | null }
    & { accessControl?: HeddleServerAccessControl }
    & { assetsDir?: string; serveAssets?: boolean },
): express.Express {
  const logger = options.logger ?? createServerLogger({ stateRoot: options.stateRoot });
  const app = express();
  const requestAccess = new HeddleServerRequestAccessService({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    registryPath: options.runtimeHost?.registryPath,
    logger,
    accessControl: options.accessControl,
  });
  const controlPlaneApis = createControlPlaneApiRouter({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    requestAccess,
  });
  const trpcHandler = createTrpcExpressRouter({
    logger,
    preferApiKey: options.preferApiKey,
    runtimeHost: options.runtimeHost,
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    requestAccess,
  });

  app.disable('x-powered-by');
  app.use('/control-plane', requestAccess.createMiddleware());
  app.use('/trpc', requestAccess.createMiddleware());
  app.use(createWorkspaceRequestLoggingMiddleware({
    logger,
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    requestAccess,
  }));
  app.use(controlPlaneApis);
  app.use(trpcHandler);

  if (options.serveAssets !== false && options.assetsDir) {
    installWebStaticRoutes(app, options.assetsDir);
  }

  return app;
}
