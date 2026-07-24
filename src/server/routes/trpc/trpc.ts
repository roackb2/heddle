import { Router } from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import type { HeddleServerRequestAccessService } from '@/server/access/index.js';
import { appRouter } from '../../router.js';
import type { HeddleRuntimeHostDescriptor, HeddleServerContext } from '../../types.js';

type CreateTrpcExpressRouterOptions = Pick<HeddleServerContext, 'workspaceRoot' | 'stateRoot' | 'logger'>
  & { preferApiKey?: boolean }
  & { runtimeHost?: HeddleRuntimeHostDescriptor | null }
  & { requestAccess: HeddleServerRequestAccessService };

export function createTrpcExpressRouter(options: CreateTrpcExpressRouterOptions): Router {
  const trpcRouter = Router();

  trpcRouter.use('/trpc', createExpressMiddleware({
    router: appRouter,
    createContext: ({ req }) => {
      const workspaceContext = options.requestAccess.resolveWorkspaceContext(req);
      const requestAccess = options.requestAccess.requireAccess(req);
      return {
        workspaceRoot: options.workspaceRoot,
        stateRoot: options.stateRoot,
        preferApiKey: Boolean(options.preferApiKey),
        activeWorkspaceId: workspaceContext.activeWorkspaceId,
        activeWorkspace: workspaceContext.activeWorkspace,
        workspaces: workspaceContext.workspaces,
        runtimeHost: options.runtimeHost ?? null,
        logger: options.logger,
        requestAccess,
        authorizeControlPlaneOperation: ({ operation }) => (
          options.requestAccess.authorizeOperation(req, operation)
        ),
        recordControlPlaneAuditEvent: (event) => options.requestAccess.recordAuditEvent(event),
      };
    },
    onError: ({ error, path, type }) => {
      options.logger.error({
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

  return trpcRouter;
}
