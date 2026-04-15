import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createServerLogger } from './logger.js';
import { createRequestLoggingMiddleware } from './middleware/request-logging.js';
import { appRouter } from './router.js';
import { installWebStaticRoutes } from './static.js';
import type { HeddleServerContext } from './types.js';

export function createHeddleServerApp(options: Omit<HeddleServerContext, 'logger'> & Partial<Pick<HeddleServerContext, 'logger'>> & { assetsDir?: string }): express.Express {
  const logger = options.logger ?? createServerLogger({ stateRoot: options.stateRoot });
  const app = express();
  app.disable('x-powered-by');
  app.use(createRequestLoggingMiddleware(logger));

  app.use('/trpc', createExpressMiddleware({
    router: appRouter,
    createContext: () => ({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
      logger,
    }),
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

  if (options.assetsDir) {
    installWebStaticRoutes(app, options.assetsDir);
  }

  return app;
}
