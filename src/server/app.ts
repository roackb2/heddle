import express from 'express';
import { createServerLogger } from './logger.js';
import { createRequestLoggingMiddleware } from './middleware/request-logging.js';
import { createTrpcExpressRouter } from './routes/trpc/trpc.js';
import { installWebStaticRoutes } from './static.js';
import type { HeddleRuntimeHostDescriptor, HeddleServerContext } from './types.js';
import { createControlPlaneApiRouter } from './routes/control-plane-apis.js';

export function createHeddleServerApp(
  options: Pick<HeddleServerContext, 'workspaceRoot' | 'stateRoot'>
    & { preferApiKey?: boolean }
    & Partial<Pick<HeddleServerContext, 'logger'>>
    & { runtimeHost?: HeddleRuntimeHostDescriptor | null }
    & { assetsDir?: string; serveAssets?: boolean },
): express.Express {
  const logger = options.logger ?? createServerLogger({ stateRoot: options.stateRoot });
  const app = express();
  const controlPlaneApis = createControlPlaneApiRouter({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
  });
  const trpcHandler = createTrpcExpressRouter({
    logger,
    preferApiKey: options.preferApiKey,
    runtimeHost: options.runtimeHost,
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
  });

  app.disable('x-powered-by');
  app.use(createRequestLoggingMiddleware(logger));
  app.use(controlPlaneApis);
  app.use(trpcHandler);

  if (options.serveAssets !== false && options.assetsDir) {
    installWebStaticRoutes(app, options.assetsDir);
  }

  return app;
}
