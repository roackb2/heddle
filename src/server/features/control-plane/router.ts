import { resolve } from 'node:path';
import { z } from 'zod';
import { BUILT_IN_MODEL_GROUPS, ModelPolicyService } from '../../../core/llm/models/index.js';
import { LlmAdapterService } from '../../../core/llm/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import { procedure, router } from '../../trpc.js';
import type { HeddleServerContext } from '../../types.js';
import { controlPlaneChatSessionsController } from './controllers/chat-sessions-controller.js';
import { ControlPlaneAskController } from './controllers/ask.js';
import { ControlPlaneStateController } from './controllers/control-plane-state.js';
import { ControlPlaneHeartbeatController } from './controllers/heartbeat.js';
import { ControlPlaneMemoryController } from './controllers/memory.js';
import { ControlPlaneLayoutSnapshotsController } from './controllers/layout-snapshots.js';
import { ControlPlaneWorkspaceFilesController } from './controllers/workspace-files.js';
import { ControlPlaneWorkspaceDiffController } from './controllers/workspace-diff.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';

const sessionInputSchema = z.object({
  id: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
});

const createSessionInputSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  retention: z.enum(['reusable', 'one_off']).optional(),
  apiKeyPresent: z.boolean().optional(),
}).optional();

const sessionMessageInputSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1),
  maxSteps: z.number().int().min(1).max(500).optional(),
  searchIgnoreDirs: z.array(z.string().min(1)).optional(),
  includePlanTool: z.boolean().optional(),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
  systemContext: z.string().min(1).optional(),
  memoryMaintenanceMode: z.enum(['background', 'inline', 'none']).optional(),
});

const sessionEventsInputSchema = z.object({
  sessionId: z.string().min(1),
});

const agentAskInputSchema = z.object({
  goal: z.string().min(1),
  model: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(500).optional(),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
  searchIgnoreDirs: z.array(z.string().min(1)).optional(),
  systemContext: z.string().min(1).optional(),
});

const turnReviewInputSchema = z.object({
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
});

const sessionApprovalDecisionSchema = z.object({
  sessionId: z.string().min(1),
  decision: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('approve'),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('deny'),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('approve_and_remember_project'),
      reason: z.string().optional(),
    }),
  ]),
});

const sessionSettingsInputSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'ultrahigh']).optional().nullable(),
  driftEnabled: z.boolean().optional(),
});

const heartbeatRunsInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).optional();

const heartbeatTaskInputSchema = z.object({
  taskId: z.string().min(1),
});

const heartbeatTaskDetailInputSchema = z.object({
  taskId: z.string().min(1),
  runLimit: z.number().int().min(1).max(100).optional(),
});

const heartbeatRunInputSchema = z.object({
  taskId: z.string().min(1),
  runId: z.string().min(1),
});

const fileSearchInputSchema = z.object({
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).optional();

const workspaceBrowseInputSchema = z.object({
  path: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(300).optional(),
  includeHidden: z.boolean().optional(),
}).optional();

const workspaceFileDiffInputSchema = z.object({
  path: z.string().min(1),
});

const memoryListInputSchema = z.object({
  path: z.string().min(1).optional(),
}).optional();

const memoryReadInputSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  maxLines: z.number().int().min(1).max(1000).optional(),
});

const memorySearchInputSchema = z.object({
  query: z.string().min(1).max(200),
  path: z.string().min(1).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
});

const layoutSnapshotInputSchema = z.object({
  snapshot: z.unknown(),
});

const workspaceSetActiveInputSchema = z.object({
  workspaceId: z.string().min(1),
});

const workspaceCreateInputSchema = z.object({
  name: z.string().min(1),
  anchorRoot: z.string().min(1),
  repoRoots: z.array(z.string().min(1)).optional(),
  setActive: z.boolean().optional(),
});

const workspaceRenameInputSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
});

export const controlPlaneRouter = router({
  state: procedure.query(async ({ ctx }) => {
    return await ControlPlaneStateController.load(ctx);
  }),
  sessions: procedure.query(({ ctx }) => {
    return {
      sessions: controlPlaneChatSessionsController.readViews(controlPlaneSessionEngineArgs(ctx)),
    };
  }),
  sessionCreate: procedure.input(createSessionInputSchema).mutation(({ ctx, input }) => {
    return controlPlaneChatSessionsController.createSession({
      ...controlPlaneSessionEngineArgs(ctx),
      suggestedName: input?.name,
      workspaceId: ctx.activeWorkspace.id,
      model: input?.model,
      retention: input?.retention,
      apiKeyPresent: input?.apiKeyPresent,
      preferApiKey: ctx.preferApiKey,
    });
  }),
  session: procedure.input(sessionInputSchema).query(({ ctx, input }) => {
    return controlPlaneChatSessionsController.readDetail(controlPlaneSessionEngineArgs(ctx), input.id) ?? null;
  }),
  sessionEvents: procedure.input(sessionEventsInputSchema).subscription(({ ctx, input, signal }) => {
    return controlPlaneChatSessionsController.subscribeLiveEvents({
      stateRoot: ctx.activeWorkspace.stateRoot,
      sessionId: input.sessionId,
      signal,
    });
  }),
  modelOptions: procedure.query(({ ctx }) => {
    const credentialMode = ModelPolicyService.credentialModeFromSource(RuntimeCredentialService.resolveCredentialSourceForModel('gpt-5.4', {
      preferApiKey: ctx.preferApiKey,
    }));
    return {
      groups: BUILT_IN_MODEL_GROUPS.map((group) => ({
        label: group.label,
        models: group.models,
        options: group.models.map((model) => ModelPolicyService.buildCredentialAwareModelOption({
          model,
          provider: LlmAdapterService.inferProvider(model),
          credentialMode,
        })),
      })),
    };
  }),
  sessionSettingsUpdate: procedure.input(sessionSettingsInputSchema).mutation(({ ctx, input }) => {
    return controlPlaneChatSessionsController.updateSettings({
      ...controlPlaneSessionEngineArgs(ctx),
      sessionId: input.id,
      settings: {
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        driftEnabled: input.driftEnabled,
      },
    });
  }),
  sessionTurnReview: procedure.input(turnReviewInputSchema).query(({ ctx, input }) => {
    return controlPlaneChatSessionsController.readTurnReview(controlPlaneSessionEngineArgs(ctx), input.sessionId, input.turnId) ?? null;
  }),
  sessionPendingApproval: procedure.input(sessionInputSchema).query(({ input }) => {
    return controlPlaneChatSessionsController.getPendingApproval(input.id) ?? null;
  }),
  sessionRunning: procedure.input(sessionInputSchema).query(({ input }) => {
    return { running: controlPlaneChatSessionsController.isRunning(input.id) };
  }),
  sessionResolveApproval: procedure.input(sessionApprovalDecisionSchema).mutation(({ input }) => {
    return {
      resolved: controlPlaneChatSessionsController.resolvePendingApproval(input.sessionId, input.decision),
    };
  }),
  sessionCancel: procedure.input(sessionInputSchema).mutation(({ input }) => {
    return {
      cancelled: controlPlaneChatSessionsController.cancelRun(input.id),
    };
  }),
  sessionSendPrompt: procedure.input(sessionMessageInputSchema).mutation(async ({ ctx, input }) => {
    return await controlPlaneChatSessionsController.submitPrompt({
      workspaceRoot: ctx.activeWorkspace.anchorRoot,
      stateRoot: ctx.activeWorkspace.stateRoot,
      sessionStoragePath: resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json'),
      sessionId: input.sessionId,
      prompt: input.prompt,
      maxSteps: input.maxSteps,
      searchIgnoreDirs: input.searchIgnoreDirs,
      includePlanTool: input.includePlanTool,
      apiKey: input.apiKey,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      systemContext: input.systemContext,
      memoryMaintenanceMode: input.memoryMaintenanceMode,
      leaseOwner: {
        ownerKind: 'daemon',
        ownerId: ctx.runtimeHost?.ownerId ?? `daemon-${process.pid}`,
        clientLabel: 'control plane',
      },
    });
  }),
  sessionContinue: procedure.input(sessionInputSchema).mutation(async ({ ctx, input }) => {
    return await controlPlaneChatSessionsController.continuePrompt({
      workspaceRoot: ctx.activeWorkspace.anchorRoot,
      stateRoot: ctx.activeWorkspace.stateRoot,
      sessionStoragePath: resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json'),
      sessionId: input.id,
      apiKey: input.apiKey,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      leaseOwner: {
        ownerKind: 'daemon',
        ownerId: ctx.runtimeHost?.ownerId ?? `daemon-${process.pid}`,
        clientLabel: 'control plane',
      },
    });
  }),
  agentAsk: procedure.input(agentAskInputSchema).mutation(async ({ ctx, input }) => {
    return await ControlPlaneAskController.run({
      goal: input.goal,
      workspaceRoot: ctx.activeWorkspace.anchorRoot,
      stateRoot: ctx.activeWorkspace.stateRoot,
      model: input.model,
      maxSteps: input.maxSteps,
      apiKey: input.apiKey,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      searchIgnoreDirs: input.searchIgnoreDirs,
      systemContext: input.systemContext,
    });
  }),
  heartbeatTasks: procedure.query(async ({ ctx }) => {
    return {
      tasks: await ControlPlaneHeartbeatController.listTasks(ctx.activeWorkspace.stateRoot),
    };
  }),
  heartbeatTask: procedure.input(heartbeatTaskDetailInputSchema).query(async ({ ctx, input }) => {
    return await ControlPlaneHeartbeatController.readTask(ctx.activeWorkspace.stateRoot, input.taskId, {
      runLimit: input.runLimit,
    });
  }),
  heartbeatRuns: procedure.input(heartbeatRunsInputSchema).query(async ({ ctx, input }) => {
    return {
      runs: await ControlPlaneHeartbeatController.listRuns(ctx.activeWorkspace.stateRoot, {
        taskId: input?.taskId,
        limit: input?.limit ?? 20,
      }),
    };
  }),
  heartbeatRun: procedure.input(heartbeatRunInputSchema).query(async ({ ctx, input }) => {
    return {
      run: await ControlPlaneHeartbeatController.readRun(ctx.activeWorkspace.stateRoot, input.taskId, input.runId) ?? null,
    };
  }),
  memoryStatus: procedure.query(async ({ ctx }) => {
    return await ControlPlaneMemoryController.readStatus(ctx.activeWorkspace.stateRoot);
  }),
  memoryList: procedure.input(memoryListInputSchema).query(async ({ ctx, input }) => {
    return await ControlPlaneMemoryController.listNotes(ctx.activeWorkspace.stateRoot, input?.path);
  }),
  memoryRead: procedure.input(memoryReadInputSchema).query(async ({ ctx, input }) => {
    return await ControlPlaneMemoryController.readNote(ctx.activeWorkspace.stateRoot, input.path, {
      offset: input.offset,
      maxLines: input.maxLines,
    });
  }),
  memorySearch: procedure.input(memorySearchInputSchema).query(async ({ ctx, input }) => {
    return await ControlPlaneMemoryController.searchNotes(ctx.activeWorkspace.stateRoot, input.query, {
      path: input.path,
      maxResults: input.maxResults,
    });
  }),
  heartbeatTaskEnable: procedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    return {
      task: await ControlPlaneHeartbeatController.setTaskEnabled(ctx.activeWorkspace.stateRoot, input.taskId, true),
    };
  }),
  heartbeatTaskDisable: procedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    return {
      task: await ControlPlaneHeartbeatController.setTaskEnabled(ctx.activeWorkspace.stateRoot, input.taskId, false),
    };
  }),
  heartbeatTaskTrigger: procedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    return {
      task: await ControlPlaneHeartbeatController.triggerTaskRun(ctx.activeWorkspace.stateRoot, input.taskId),
    };
  }),
  workspaceFileSearch: procedure.input(fileSearchInputSchema).query(async ({ ctx, input }) => {
    return {
      files: await ControlPlaneWorkspaceFilesController.searchFiles({
        workspaceRoot: ctx.activeWorkspace.anchorRoot,
        query: input?.query ?? '',
        limit: input?.limit ?? 20,
      }),
    };
  }),
  workspaceBrowse: procedure.input(workspaceBrowseInputSchema).query(async ({ input }) => {
    return await ControlPlaneWorkspaceFilesController.browseDirectories({
      path: input?.path,
      limit: input?.limit ?? 100,
      includeHidden: input?.includeHidden ?? false,
    });
  }),
  workspaceChanges: procedure.query(async ({ ctx }) => {
    return await ControlPlaneWorkspaceDiffController.readChanges(ctx.activeWorkspace.anchorRoot);
  }),
  workspaceFileDiff: procedure.input(workspaceFileDiffInputSchema).query(async ({ ctx, input }) => {
    return await ControlPlaneWorkspaceDiffController.readFileDiff(ctx.activeWorkspace.anchorRoot, input.path);
  }),
  workspaceSetActive: procedure.input(workspaceSetActiveInputSchema).mutation(({ ctx, input }) => {
    const resolved = RuntimeWorkspaceService.setActive({
      workspaceRoot: ctx.workspaceRoot,
      stateRoot: ctx.stateRoot,
      workspaceId: input.workspaceId,
    });
    registerControlPlaneWorkspaces(ctx, resolved.workspaces);
    return {
      activeWorkspaceId: resolved.activeWorkspaceId,
      workspace: resolved.activeWorkspace,
      workspaces: resolved.workspaces,
    };
  }),
  workspaceCreate: procedure.input(workspaceCreateInputSchema).mutation(({ ctx, input }) => {
    const resolved = RuntimeWorkspaceService.createDescriptor({
      workspaceRoot: ctx.workspaceRoot,
      stateRoot: ctx.stateRoot,
      name: input.name,
      anchorRoot: input.anchorRoot,
      repoRoots: input.repoRoots,
      setActive: input.setActive,
    });
    registerControlPlaneWorkspaces(ctx, resolved.workspaces);
    return {
      activeWorkspaceId: resolved.activeWorkspaceId,
      workspace: resolved.activeWorkspace,
      workspaces: resolved.workspaces,
    };
  }),
  workspaceRename: procedure.input(workspaceRenameInputSchema).mutation(({ ctx, input }) => {
    const resolved = RuntimeWorkspaceService.rename({
      workspaceRoot: ctx.workspaceRoot,
      stateRoot: ctx.stateRoot,
      workspaceId: input.workspaceId,
      name: input.name,
    });
    registerControlPlaneWorkspaces(ctx, resolved.workspaces);
    return {
      activeWorkspaceId: resolved.activeWorkspaceId,
      workspace: resolved.activeWorkspace,
      workspaces: resolved.workspaces,
    };
  }),
  layoutSnapshotSave: procedure.input(layoutSnapshotInputSchema).mutation(async ({ ctx, input }) => {
    return await ControlPlaneLayoutSnapshotsController.save(ctx.activeWorkspace.stateRoot, input.snapshot);
  }),
});

function controlPlaneSessionEngineArgs(ctx: HeddleServerContext) {
  return {
    workspaceRoot: ctx.activeWorkspace.anchorRoot,
    stateRoot: ctx.activeWorkspace.stateRoot,
    sessionStoragePath: resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json'),
    preferApiKey: ctx.preferApiKey,
    workspaceId: ctx.activeWorkspace.id,
  };
}

function registerControlPlaneWorkspaces(
  ctx: HeddleServerContext,
  workspaces: Parameters<typeof RuntimeDaemonRegistryService.registerKnownWorkspaces>[0]['workspaces'],
) {
  RuntimeDaemonRegistryService.registerKnownWorkspaces({
    registryPath: ctx.runtimeHost?.registryPath ?? FileDaemonRegistryRepository.resolvePath(),
    workspaces,
  });
}
