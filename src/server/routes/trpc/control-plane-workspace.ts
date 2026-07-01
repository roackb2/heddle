import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { AutonomyPermissionModeService, type AutopilotProfile } from '@/core/approvals/index.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { getWorkspaceOperationLogger } from '@/server/logging/workspace-operation-logger.js';
import type { HeddleServerContext } from '@/server/types.js';
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
  .use(async ({ ctx, input, next, path, type }) => {
    const requestWorkspace = resolveControlPlaneRequestWorkspace(ctx, input);
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
