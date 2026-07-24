import { resolve } from 'node:path';
import { TRPCError } from '@trpc/server';
import type { Logger } from 'pino';
import { AutonomyPermissionModeService, type AutopilotProfile } from '@/core/approvals/index.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { getWorkspaceOperationLogger } from '@/server/logging/workspace-operation-logger.js';
import type { HeddleServerContext } from '@/server/types.js';
import {
  HeddleServerAccessError,
  assertHeddleServerSessionAccess,
  assertHeddleServerWorkspaceAccess,
} from '@/server/access/index.js';
import { procedure } from '@/server/trpc.js';
import { workspaceScopedInputSchema } from './schema.js';

type WorkspaceScopedInput = {
  workspaceId?: string;
} | null | undefined;

export type ControlPlaneRequestWorkspace = {
  workspace: WorkspaceDescriptor;
  logger: Logger;
  sessionEngineArgs: {
    workspaceRoot: string;
    stateRoot: string;
    sessionStoragePath: string;
    credentialStorePath: string;
    preferApiKey: boolean;
    workspaceId: string;
    autopilot?: AutopilotProfile;
  };
};

export type ControlPlaneWorkspaceContext = HeddleServerContext & {
  requestWorkspace: ControlPlaneRequestWorkspace;
};

export const controlPlaneWorkspaceProcedure = procedure
  .input(workspaceScopedInputSchema)
  .use(async ({ ctx, input, next, path, type, getRawInput }) => {
    let requestWorkspace: ControlPlaneRequestWorkspace;
    try {
      requestWorkspace = resolveControlPlaneRequestWorkspace(ctx, input);
      const rawInput = await getRawInput();
      const operation = {
        name: resolveOperationName(path),
        type,
        workspaceId: requestWorkspace.workspace.id,
        sessionId: resolveSessionId(path, rawInput),
      };
      if (operation.sessionId) {
        assertHeddleServerSessionAccess(
          ctx.requestAccess,
          requestWorkspace.workspace.id,
          operation.sessionId,
        );
      }
      await ctx.authorizeControlPlaneOperation?.({
        access: ctx.requestAccess,
        operation,
      });
    } catch (error) {
      throw projectAccessError(error);
    }
    const startedAt = Date.now();
    const result = await next({
      ctx: {
        requestWorkspace,
      },
    });

    requestWorkspace.logger.info({
      durationMs: Date.now() - startedAt,
      ok: result.ok,
      path,
      type,
      workspaceId: requestWorkspace.workspace.id,
      workspaceRoot: requestWorkspace.workspace.workspaceRoot,
      stateRoot: requestWorkspace.workspace.stateRoot,
      error: result.ok ? undefined : {
        code: result.error.code,
        message: result.error.message,
      },
    }, 'Control-plane workspace request');

    return result;
  });

export const controlPlaneLocalProcedure = procedure.use(({ ctx, next }) => {
  if (ctx.requestAccess.mode !== 'local') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This control-plane operation is available only in local-daemon mode.',
    });
  }
  return next();
});

/**
 * Resolves the workspace for one control-plane request.
 *
 * Web v2 routes carry the workspace being viewed. Every workspace-owned
 * tRPC procedure should resolve through this helper so reads, mutations,
 * subscriptions, traces, logs, memory, and task state use the same state root.
 */
export function resolveControlPlaneRequestWorkspace(
  ctx: HeddleServerContext,
  input?: WorkspaceScopedInput,
): ControlPlaneRequestWorkspace {
  const workspace = resolveWorkspaceDescriptor(ctx, input?.workspaceId);
  const projectConfig = ProjectConfigService.read(workspace.workspaceRoot);
  const autopilot = AutonomyPermissionModeService.resolveEffectiveProfile({
    config: projectConfig,
    workspaceRoot: workspace.workspaceRoot,
  });
  const logger = getWorkspaceOperationLogger(workspace.stateRoot);
  return {
    workspace,
    logger,
    sessionEngineArgs: {
      workspaceRoot: workspace.workspaceRoot,
      stateRoot: workspace.stateRoot,
      sessionStoragePath: resolve(workspace.stateRoot, 'chat-sessions.catalog.json'),
      credentialStorePath: ProviderCredentialRepository.resolveStorePath(workspace.stateRoot),
      preferApiKey: ctx.preferApiKey,
      workspaceId: workspace.id,
      autopilot,
    },
  };
}

function resolveWorkspaceDescriptor(ctx: HeddleServerContext, workspaceId: string | undefined): WorkspaceDescriptor {
  if (!workspaceId) {
    return ctx.activeWorkspace;
  }

  assertHeddleServerWorkspaceAccess(ctx.requestAccess, workspaceId);
  const workspace =
    ctx.workspaces.find((candidate) => candidate.id === workspaceId)
    ?? RuntimeDaemonRegistryService.readWorkspaceRegistration(
      ctx.runtimeHost?.registryPath ?? FileDaemonRegistryRepository.resolvePath(),
      workspaceId,
    )?.workspace;
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  return workspace;
}

function resolveOperationName(path: string): string {
  return path.split('.').at(-1) ?? path;
}

function resolveSessionId(path: string, input: unknown): string | undefined {
  const operationName = resolveOperationName(path);
  const sessionScoped =
    (
      operationName.startsWith('session')
      && !['sessionCreate', 'sessions', 'sessionsEvents'].includes(operationName)
    )
    || operationName === 'slashCommandExecute';
  if (!sessionScoped || !input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const inputRecord = input as Record<string, unknown>;
  const sessionId = inputRecord.sessionId ?? inputRecord.id;
  return typeof sessionId === 'string' ? sessionId : undefined;
}

function projectAccessError(error: unknown): Error {
  if (!(error instanceof HeddleServerAccessError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return new TRPCError({
    code: error.statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
    message: error.message,
  });
}
