import { Router } from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import { appRouter } from '../../router.js';
import type { HeddleRuntimeHostDescriptor, HeddleServerContext } from '../../types.js';

type CreateTrpcExpressRouterOptions = Pick<HeddleServerContext, 'workspaceRoot' | 'stateRoot' | 'logger'>
  & { preferApiKey?: boolean }
  & { runtimeHost?: HeddleRuntimeHostDescriptor | null };

export function createTrpcExpressRouter(options: CreateTrpcExpressRouterOptions): Router {
  const trpcRouter = Router();

  trpcRouter.use('/trpc', createExpressMiddleware({
    router: appRouter,
    createContext: () => {
      const workspaceContext = RuntimeWorkspaceService.resolveContext({
        workspaceRoot: options.workspaceRoot,
        stateRoot: options.stateRoot,
      });
      const workspaceOwner =
        options.runtimeHost ?
          RuntimeDaemonRegistryService.readWorkspaceRegistration(
            options.runtimeHost.registryPath,
            workspaceContext.activeWorkspaceId,
            workspaceContext.activeWorkspace.stateRoot,
          )?.owner ?? null
        : null;
      return {
        workspaceRoot: options.workspaceRoot,
        stateRoot: options.stateRoot,
        preferApiKey: Boolean(options.preferApiKey),
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
        logger: options.logger,
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
