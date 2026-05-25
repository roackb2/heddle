import dayjs from 'dayjs';
import { BUILT_IN_MODEL_GROUPS, ModelPolicyService } from '@/core/llm/models/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import { procedure, router } from '@/server/trpc.js';
import type { HeddleServerContext } from '@/server/types.js';
import { controlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';
import { ControlPlaneAskController } from '@/server/controllers/trpc/control-plane/ask.js';
import { ControlPlaneStateController } from '@/server/controllers/trpc/control-plane/control-plane-state.js';
import { ControlPlaneHeartbeatController } from '@/server/controllers/trpc/control-plane/heartbeat.js';
import { controlPlaneHeartbeatEventsController } from '@/server/controllers/trpc/control-plane/heartbeat-events.js';
import { ControlPlaneMemoryController } from '@/server/controllers/trpc/control-plane/memory.js';
import { ControlPlaneLayoutSnapshotsController } from '@/server/controllers/trpc/control-plane/layout-snapshots.js';
import { ControlPlaneWorkspaceFilesController } from '@/server/controllers/trpc/control-plane/workspace-files.js';
import { ControlPlaneWorkspaceDiffController } from '@/server/controllers/trpc/control-plane/workspace-diff.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import { controlPlaneWorkspaceProcedure } from './control-plane-workspace.js';
import {
  agentAskInputSchema,
  createSessionInputSchema,
  fileSearchInputSchema,
  heartbeatRunInputSchema,
  heartbeatRunsInputSchema,
  heartbeatTaskCreateInputSchema,
  heartbeatTaskDetailInputSchema,
  heartbeatTaskInputSchema,
  heartbeatTaskRunNowInputSchema,
  heartbeatTaskUpdateInputSchema,
  layoutSnapshotInputSchema,
  memoryListInputSchema,
  memoryReadInputSchema,
  memorySearchInputSchema,
  sessionApprovalDecisionSchema,
  sessionEventsInputSchema,
  sessionInputSchema,
  sessionMessageInputSchema,
  sessionsEventsInputSchema,
  sessionsInputSchema,
  sessionSettingsInputSchema,
  turnReviewInputSchema,
  workspaceBrowseInputSchema,
  workspaceCreateInputSchema,
  workspaceFileDiffInputSchema,
  workspaceRenameInputSchema,
  workspaceSetActiveInputSchema,
} from './schema.js';

export const controlPlaneRouter = router({
  state: controlPlaneWorkspaceProcedure.query(async ({ ctx }) => {
    return await ControlPlaneStateController.load(ctx, ctx.requestWorkspace.workspace);
  }),
  sessions: controlPlaneWorkspaceProcedure.input(sessionsInputSchema).query(({ ctx }) => {
    const requestWorkspace = ctx.requestWorkspace;
    return {
      workspaceId: requestWorkspace.workspace.id,
      sessions: controlPlaneChatSessionsController.readViews(requestWorkspace.sessionEngineArgs),
    };
  }),
  sessionsEvents: controlPlaneWorkspaceProcedure.input(sessionsEventsInputSchema).subscription(({ ctx, signal }) => {
    const { workspace } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.subscribeSessionListEvents({
      stateRoot: workspace.stateRoot,
      signal,
    });
  }),
  sessionCreate: controlPlaneWorkspaceProcedure.input(createSessionInputSchema).mutation(({ ctx, input }) => {
    const { workspace, sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.createSession({
      ...sessionEngineArgs,
      suggestedName: input?.name,
      workspaceId: workspace.id,
      model: input?.model,
      retention: input?.retention,
      apiKeyPresent: input?.apiKeyPresent,
      preferApiKey: ctx.preferApiKey,
    });
  }),
  session: controlPlaneWorkspaceProcedure.input(sessionInputSchema).query(({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.readDetail(sessionEngineArgs, input.id) ?? null;
  }),
  sessionEvents: controlPlaneWorkspaceProcedure.input(sessionEventsInputSchema).subscription(({ ctx, input, signal }) => {
    const { workspace } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.subscribeLiveEvents({
      workspaceId: workspace.id,
      stateRoot: workspace.stateRoot,
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
  sessionSettingsUpdate: controlPlaneWorkspaceProcedure.input(sessionSettingsInputSchema).mutation(({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.updateSettings({
      ...sessionEngineArgs,
      sessionId: input.id,
      settings: {
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        driftEnabled: input.driftEnabled,
      },
    });
  }),
  sessionTurnReview: controlPlaneWorkspaceProcedure.input(turnReviewInputSchema).query(({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.readTurnReview(sessionEngineArgs, input.sessionId, input.turnId) ?? null;
  }),
  sessionPendingApproval: controlPlaneWorkspaceProcedure.input(sessionInputSchema).query(({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.getPendingApproval({
      workspaceId: workspace.id,
      sessionId: input.id,
    }) ?? null;
  }),
  sessionRunning: controlPlaneWorkspaceProcedure.input(sessionInputSchema).query(({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      running: controlPlaneChatSessionsController.isRunning({
        workspaceId: workspace.id,
        sessionId: input.id,
      }),
    };
  }),
  sessionResolveApproval: controlPlaneWorkspaceProcedure.input(sessionApprovalDecisionSchema).mutation(({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      resolved: controlPlaneChatSessionsController.resolvePendingApproval({
        workspaceId: workspace.id,
        sessionId: input.sessionId,
      }, input.decision),
    };
  }),
  sessionCancel: controlPlaneWorkspaceProcedure.input(sessionInputSchema).mutation(({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      cancelled: controlPlaneChatSessionsController.cancelRun({
        workspaceId: workspace.id,
        sessionId: input.id,
      }),
    };
  }),
  sessionSendPrompt: controlPlaneWorkspaceProcedure.input(sessionMessageInputSchema).mutation(async ({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return await controlPlaneChatSessionsController.submitPrompt({
      ...sessionEngineArgs,
      sessionId: input.sessionId,
      prompt: input.prompt,
      maxSteps: input.maxSteps,
      searchIgnoreDirs: input.searchIgnoreDirs,
      includePlanTool: input.includePlanTool,
      apiKey: input.apiKey,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      logger: ctx.logger,
      systemContext: input.systemContext,
      memoryMaintenanceMode: input.memoryMaintenanceMode,
      leaseOwner: {
        ownerKind: 'daemon',
        ownerId: ctx.runtimeHost?.ownerId ?? `daemon-${process.pid}`,
        clientLabel: 'control plane',
      },
    });
  }),
  sessionContinue: controlPlaneWorkspaceProcedure.input(sessionInputSchema).mutation(async ({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return await controlPlaneChatSessionsController.continuePrompt({
      ...sessionEngineArgs,
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
  agentAsk: controlPlaneWorkspaceProcedure.input(agentAskInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneAskController.run({
      goal: input.goal,
      workspaceRoot: workspace.workspaceRoot,
      stateRoot: workspace.stateRoot,
      model: input.model,
      maxSteps: input.maxSteps,
      apiKey: input.apiKey,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      searchIgnoreDirs: input.searchIgnoreDirs,
      systemContext: input.systemContext,
    });
  }),
  heartbeatTasks: controlPlaneWorkspaceProcedure.query(async ({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      workspaceId: workspace.id,
      tasks: await ControlPlaneHeartbeatController.listTasks(workspace.stateRoot),
    };
  }),
  heartbeatTaskCreate: controlPlaneWorkspaceProcedure.input(heartbeatTaskCreateInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    const { workspaceId: _workspaceId, ...taskInput } = input;
    return {
      task: await ControlPlaneHeartbeatController.createTask(workspace.stateRoot, {
        ...taskInput,
        workspaceId: workspace.id,
        workspaceRoot: workspace.workspaceRoot,
        stateDir: workspace.stateRoot,
      }),
    };
  }),
  heartbeatTaskUpdate: controlPlaneWorkspaceProcedure.input(heartbeatTaskUpdateInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    const { workspaceId: _workspaceId, taskId: _taskId, ...taskInput } = input;
    return {
      task: await ControlPlaneHeartbeatController.updateTask(workspace.stateRoot, input.taskId, taskInput),
    };
  }),
  heartbeatTaskDelete: controlPlaneWorkspaceProcedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      task: await ControlPlaneHeartbeatController.deleteTask(workspace.stateRoot, input.taskId),
    };
  }),
  heartbeatTask: controlPlaneWorkspaceProcedure.input(heartbeatTaskDetailInputSchema).query(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneHeartbeatController.readTask(workspace.stateRoot, input.taskId, {
      runLimit: input.runLimit,
    });
  }),
  heartbeatEvents: controlPlaneWorkspaceProcedure.subscription(({ ctx, signal }) => {
    const { workspace } = ctx.requestWorkspace;
    return controlPlaneHeartbeatEventsController.subscribe({
      workspaceId: workspace.id,
      signal,
    });
  }),
  heartbeatRuns: controlPlaneWorkspaceProcedure.input(heartbeatRunsInputSchema).query(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      runs: await ControlPlaneHeartbeatController.listRuns(workspace.stateRoot, {
        taskId: input?.taskId,
        limit: input?.limit ?? 20,
      }),
    };
  }),
  heartbeatRun: controlPlaneWorkspaceProcedure.input(heartbeatRunInputSchema).query(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      run: await ControlPlaneHeartbeatController.readRun(workspace.stateRoot, input.taskId, input.runId) ?? null,
    };
  }),
  memoryStatus: controlPlaneWorkspaceProcedure.query(async ({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneMemoryController.readStatus(workspace.stateRoot);
  }),
  memoryList: controlPlaneWorkspaceProcedure.input(memoryListInputSchema).query(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneMemoryController.listNotes(workspace.stateRoot, input?.path);
  }),
  memoryRead: controlPlaneWorkspaceProcedure.input(memoryReadInputSchema).query(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneMemoryController.readNote(workspace.stateRoot, input.path, {
      offset: input.offset,
      maxLines: input.maxLines,
    });
  }),
  memorySearch: controlPlaneWorkspaceProcedure.input(memorySearchInputSchema).query(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneMemoryController.searchNotes(workspace.stateRoot, input.query, {
      path: input.path,
      maxResults: input.maxResults,
    });
  }),
  heartbeatTaskEnable: controlPlaneWorkspaceProcedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      task: await ControlPlaneHeartbeatController.setTaskEnabled(workspace.stateRoot, input.taskId, true),
    };
  }),
  heartbeatTaskDisable: controlPlaneWorkspaceProcedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      task: await ControlPlaneHeartbeatController.setTaskEnabled(workspace.stateRoot, input.taskId, false),
    };
  }),
  heartbeatTaskResume: controlPlaneWorkspaceProcedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    const task = await ControlPlaneHeartbeatController.resumeTask(workspace.stateRoot, input.taskId);
    controlPlaneHeartbeatEventsController.publish({
      workspaceId: workspace.id,
      event: {
        type: 'heartbeat.task.due',
        taskId: input.taskId,
        timestamp: dayjs().toISOString(),
      },
    });
    return { task };
  }),
  heartbeatTaskTrigger: controlPlaneWorkspaceProcedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      task: await ControlPlaneHeartbeatController.triggerTaskRun(workspace.stateRoot, input.taskId),
    };
  }),
  heartbeatTaskRunNow: controlPlaneWorkspaceProcedure.input(heartbeatTaskRunNowInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    const { workspaceId: _workspaceId, ...runInput } = input;
    const task = await ControlPlaneHeartbeatController.triggerTaskRun(workspace.stateRoot, input.taskId);
    controlPlaneHeartbeatEventsController.publish({
      workspaceId: workspace.id,
      event: {
        type: 'heartbeat.task.due',
        taskId: input.taskId,
        timestamp: dayjs().toISOString(),
      },
    });

    void ControlPlaneHeartbeatController.runTaskNow(workspace.stateRoot, {
      ...runInput,
      workspaceRoot: workspace.workspaceRoot,
      stateDir: workspace.stateRoot,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      onEvent: (event) => controlPlaneHeartbeatEventsController.publish({
        workspaceId: workspace.id,
        event,
      }),
    }).catch((error: unknown) => {
      ctx.logger.error({ error, taskId: input.taskId }, 'Failed to run heartbeat task from control plane');
    });

    return {
      accepted: true,
      task,
      run: null,
    };
  }),
  workspaceFileSearch: controlPlaneWorkspaceProcedure.input(fileSearchInputSchema).query(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      workspaceId: workspace.id,
      files: await ControlPlaneWorkspaceFilesController.searchFiles({
        workspaceRoot: workspace.workspaceRoot,
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
  workspaceChanges: controlPlaneWorkspaceProcedure.query(async ({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      workspaceId: workspace.id,
      ...await ControlPlaneWorkspaceDiffController.readChanges(workspace.workspaceRoot),
    };
  }),
  workspaceFileDiff: controlPlaneWorkspaceProcedure.input(workspaceFileDiffInputSchema).query(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      workspaceId: workspace.id,
      ...await ControlPlaneWorkspaceDiffController.readFileDiff(workspace.workspaceRoot, input.path),
    };
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
      newWorkspaceRoot: input.workspaceRoot,
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
  layoutSnapshotSave: controlPlaneWorkspaceProcedure.input(layoutSnapshotInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneLayoutSnapshotsController.save(workspace.stateRoot, input.snapshot);
  }),
});

function registerControlPlaneWorkspaces(
  ctx: HeddleServerContext,
  workspaces: Parameters<typeof RuntimeDaemonRegistryService.registerKnownWorkspaces>[0]['workspaces'],
) {
  RuntimeDaemonRegistryService.registerKnownWorkspaces({
    registryPath: ctx.runtimeHost?.registryPath ?? FileDaemonRegistryRepository.resolvePath(),
    workspaces,
  });
}
