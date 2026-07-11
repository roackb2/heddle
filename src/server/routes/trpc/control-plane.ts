import dayjs from 'dayjs';
import type { z } from 'zod';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import { ModelOptionsService, ModelPolicyService } from '@/core/llm/models/index.js';
import { AutonomyPermissionModeService } from '@/core/approvals/index.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
import { procedure, router } from '@/server/trpc.js';
import type { HeddleServerContext } from '@/server/types.js';
import { controlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';
import { ControlPlaneAskController } from '@/server/controllers/trpc/control-plane/ask.js';
import { ControlPlaneStateController } from '@/server/controllers/trpc/control-plane/control-plane-state.js';
import { ControlPlaneHeartbeatController } from '@/server/controllers/trpc/control-plane/heartbeat.js';
import { controlPlaneHeartbeatEventsController } from '@/server/controllers/trpc/control-plane/heartbeat-events.js';
import { ControlPlaneMemoryController } from '@/server/controllers/trpc/control-plane/memory.js';
import { ControlPlaneMcpController } from '@/server/controllers/trpc/control-plane/mcp.js';
import { ControlPlaneBrowserAutomationController } from '@/server/controllers/trpc/control-plane/browser-automation.js';
import { ControlPlaneLayoutSnapshotsController } from '@/server/controllers/trpc/control-plane/layout-snapshots.js';
import { ControlPlaneWorkspaceFilesController } from '@/server/controllers/trpc/control-plane/workspace-files.js';
import { ControlPlaneWorkspaceDiffController } from '@/server/controllers/trpc/control-plane/workspace-diff.js';
import { ControlPlaneSkillsController } from '@/server/controllers/trpc/control-plane/skills.js';
import { controlPlaneSlashCommandsController } from '@/server/controllers/trpc/control-plane/slash-commands-controller.js';
import { controlPlaneSessionRuntimeContextService } from '@/server/services/control-plane/session-runtime-context-service.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import { CustomAgentService } from '@/core/custom-agents/index.js';
import { BrowserAutomationIntentContextService } from '@/core/browser/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import { controlPlaneWorkspaceProcedure, type ControlPlaneWorkspaceContext } from './control-plane-workspace.js';
import {
  agentAskInputSchema,
  browserAutomationInputSchema,
  browserAutomationNativeLaunchInputSchema,
  browserAutomationNativeStatusInputSchema,
  browserAutomationProfileCloseInputSchema,
  browserAutomationProfileOpenInputSchema,
  browserAutomationSettingsInputSchema,
  createSessionInputSchema,
  customAgentCreateInputSchema,
  customAgentInputSchema,
  fileSearchInputSchema,
  heartbeatRunInputSchema,
  heartbeatRunDueTasksInputSchema,
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
  mcpConfigInputSchema,
  sessionApprovalDecisionSchema,
  sessionArchivedUpdateInputSchema,
  sessionCancelInputSchema,
  sessionCompactInputSchema,
  sessionDirectShellInputSchema,
  sessionDirectShellPreflightInputSchema,
  sessionEventsInputSchema,
  sessionInputSchema,
  sessionMessageInputSchema,
  sessionPinnedUpdateInputSchema,
  sessionQueuedPromptInputSchema,
  sessionQueuedPromptUpdateInputSchema,
  sessionRenameInputSchema,
  sessionRuntimeContextInputSchema,
  sessionRunEventsInputSchema,
  skillInputSchema,
  mcpServerInputSchema,
  slashCommandCatalogInputSchema,
  slashCommandExecuteInputSchema,
  sessionsEventsInputSchema,
  sessionsInputSchema,
  sessionSettingsInputSchema,
  turnReviewInputSchema,
  workspaceBrowseInputSchema,
  workspaceCreateInputSchema,
  workspaceFileDiffInputSchema,
  workspacePermissionModeUpdateInputSchema,
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
      workspaceId: workspace.id,
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
  sessionRunEvents: controlPlaneWorkspaceProcedure.input(sessionRunEventsInputSchema).subscription(({ ctx, input, signal }) => {
    const { workspace } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.subscribeRunEvents({
      workspaceId: workspace.id,
      sessionId: input.sessionId,
      runId: input.runId,
      afterSequence: input.afterSequence,
      signal,
    });
  }),
  modelOptions: procedure.query(async ({ ctx }) => {
    return await ModelOptionsService.resolve({
      credentialModes: {
        openai: ModelPolicyService.credentialModeFromSource(RuntimeCredentialService.resolveCredentialSourceForModel('gpt-5.4', {
          preferApiKey: ctx.preferApiKey,
        })),
        anthropic: ModelPolicyService.credentialModeFromSource(RuntimeCredentialService.resolveCredentialSourceForModel('claude-sonnet-4-6', {
          preferApiKey: ctx.preferApiKey,
        })),
        ollama: 'api-key',
      },
      openAiCompatibleSources: RuntimeCredentialService.resolveOpenAiCompatibleModelDiscoverySources(),
    });
  }),
  customAgents: controlPlaneWorkspaceProcedure.query(({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return new CustomAgentService({
      workspaceRoot: workspace.workspaceRoot,
    }).catalog();
  }),
  customAgentCreate: controlPlaneWorkspaceProcedure.input(customAgentCreateInputSchema).mutation(({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return new CustomAgentService({
      workspaceRoot: workspace.workspaceRoot,
    }).createProjectAgent(input);
  }),
  customAgentDelete: controlPlaneWorkspaceProcedure.input(customAgentInputSchema).mutation(({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return new CustomAgentService({
      workspaceRoot: workspace.workspaceRoot,
    }).deleteProjectAgent(input.agentProfileId);
  }),
  workspacePermissionModeUpdate: controlPlaneWorkspaceProcedure.input(workspacePermissionModeUpdateInputSchema).mutation(({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    const config = ProjectConfigService.update(workspace.workspaceRoot, (current) => (
      AutonomyPermissionModeService.applyMode({
        config: current,
        mode: input.mode,
        workspaceRoot: workspace.workspaceRoot,
      })
    ));
    const permissionMode = AutonomyPermissionModeService.resolveMode({
      config,
      workspaceRoot: workspace.workspaceRoot,
    });
    return {
      permissionMode,
      permissionModeOptions: AutonomyPermissionModeService.buildOptions({
        config,
        workspaceRoot: workspace.workspaceRoot,
      }),
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
  sessionRename: controlPlaneWorkspaceProcedure.input(sessionRenameInputSchema).mutation(({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.renameSession({
      ...sessionEngineArgs,
      sessionId: input.id,
      name: input.name,
    });
  }),
  sessionPinnedUpdate: controlPlaneWorkspaceProcedure.input(sessionPinnedUpdateInputSchema).mutation(({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.updatePinned({
      ...sessionEngineArgs,
      sessionId: input.id,
      pinned: input.pinned,
    });
  }),
  sessionArchivedUpdate: controlPlaneWorkspaceProcedure.input(sessionArchivedUpdateInputSchema).mutation(({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.updateArchived({
      ...sessionEngineArgs,
      sessionId: input.id,
      archived: input.archived,
    });
  }),
  sessionDelete: controlPlaneWorkspaceProcedure.input(sessionInputSchema).mutation(({ ctx, input }) => {
    const { workspace, sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.deleteSession({
      ...sessionEngineArgs,
      workspaceId: workspace.id,
      sessionId: input.id,
      leaseOwner: resolveControlPlaneLeaseOwner(ctx),
    });
  }),
  sessionReset: controlPlaneWorkspaceProcedure.input(sessionInputSchema).mutation(({ ctx, input }) => {
    const { workspace, sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.resetSession({
      ...sessionEngineArgs,
      workspaceId: workspace.id,
      sessionId: input.id,
      apiKey: input.apiKey,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      leaseOwner: resolveControlPlaneLeaseOwner(ctx),
    });
  }),
  sessionCompact: controlPlaneWorkspaceProcedure.input(sessionCompactInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace, sessionEngineArgs } = ctx.requestWorkspace;
    return await controlPlaneChatSessionsController.compactSession({
      ...sessionEngineArgs,
      workspaceId: workspace.id,
      sessionId: input.id,
      force: input.force,
      apiKey: input.apiKey,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      systemContext: input.systemContext,
      leaseOwner: resolveControlPlaneLeaseOwner(ctx),
    });
  }),
  sessionTurnReview: controlPlaneWorkspaceProcedure.input(turnReviewInputSchema).query(({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.readTurnReview(sessionEngineArgs, input.sessionId, input.turnId) ?? null;
  }),
  sessionRunState: controlPlaneWorkspaceProcedure.input(sessionInputSchema).query(({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.readRunState({
      workspaceId: workspace.id,
      sessionId: input.id,
    });
  }),
  sessionRuntimeContext: controlPlaneWorkspaceProcedure.input(sessionRuntimeContextInputSchema).query(({ ctx, input }) => {
    const { workspace, sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneSessionRuntimeContextService.read({
      ...sessionEngineArgs,
      sessionId: input.sessionId,
      preferApiKey: ctx.preferApiKey,
    }, {
      running: controlPlaneChatSessionsController.isRunning({
        workspaceId: workspace.id,
        sessionId: input.sessionId,
      }),
    });
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
      }, input.decision, input.runId),
    };
  }),
  sessionCancel: controlPlaneWorkspaceProcedure.input(sessionCancelInputSchema).mutation(({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return {
      cancelled: controlPlaneChatSessionsController.cancelRun({
        workspaceId: workspace.id,
        sessionId: input.id,
      }, input.runId),
    };
  }),
  sessionSendPrompt: controlPlaneWorkspaceProcedure.input(sessionMessageInputSchema).mutation(async ({ ctx, input }) => {
    return await controlPlaneChatSessionsController.submitPrompt(buildSubmitPromptArgs(ctx, input));
  }),
  sessionSendPromptAsync: controlPlaneWorkspaceProcedure.input(sessionMessageInputSchema).mutation(({ ctx, input }) => {
    return controlPlaneChatSessionsController.submitPromptAsync(buildSubmitPromptArgs(ctx, input));
  }),
  sessionDirectShellPreflight: controlPlaneWorkspaceProcedure.input(sessionDirectShellPreflightInputSchema).query(({ input }) => {
    return controlPlaneChatSessionsController.preflightDirectShell(input.command);
  }),
  sessionDirectShellAsync: controlPlaneWorkspaceProcedure.input(sessionDirectShellInputSchema).mutation(({ ctx, input }) => {
    const { workspace, sessionEngineArgs } = ctx.requestWorkspace;
    return controlPlaneChatSessionsController.submitDirectShellAsync({
      ...sessionEngineArgs,
      workspaceId: workspace.id,
      sessionId: input.sessionId,
      command: input.command,
      riskAccepted: input.riskAccepted,
      apiKey: input.apiKey,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      systemContext: input.systemContext,
      leaseOwner: resolveControlPlaneLeaseOwner(ctx),
    });
  }),
  sessionQueuedPromptUpdate: controlPlaneWorkspaceProcedure.input(sessionQueuedPromptUpdateInputSchema).mutation(({ ctx, input }) => {
    return controlPlaneChatSessionsController.updateQueuedPrompt({
      ...ctx.requestWorkspace.sessionEngineArgs,
      workspaceId: ctx.requestWorkspace.workspace.id,
      sessionId: input.sessionId,
      queueItemId: input.queueItemId,
      prompt: input.prompt,
    });
  }),
  sessionQueuedPromptDelete: controlPlaneWorkspaceProcedure.input(sessionQueuedPromptInputSchema).mutation(({ ctx, input }) => {
    return controlPlaneChatSessionsController.deleteQueuedPrompt({
      ...ctx.requestWorkspace.sessionEngineArgs,
      workspaceId: ctx.requestWorkspace.workspace.id,
      sessionId: input.sessionId,
      queueItemId: input.queueItemId,
    });
  }),
  slashCommandCatalog: controlPlaneWorkspaceProcedure.input(slashCommandCatalogInputSchema).query(() => {
    return controlPlaneSlashCommandsController.catalog();
  }),
  slashCommandExecute: controlPlaneWorkspaceProcedure.input(slashCommandExecuteInputSchema).mutation(async ({ ctx, input }) => {
    return await controlPlaneSlashCommandsController.execute({
      ...ctx.requestWorkspace.sessionEngineArgs,
      sessionId: input.sessionId,
      preferApiKey: ctx.preferApiKey,
      leaseOwner: resolveControlPlaneLeaseOwner(ctx),
      compactActive: async () => {
        await controlPlaneChatSessionsController.compactSession({
          ...ctx.requestWorkspace.sessionEngineArgs,
          sessionId: input.sessionId,
          force: true,
          preferApiKey: ctx.preferApiKey,
          leaseOwner: resolveControlPlaneLeaseOwner(ctx),
        });
        return 'Compacted earlier session history for the next run.';
      },
    }, input.command);
  }),
  sessionContinue: controlPlaneWorkspaceProcedure.input(sessionInputSchema).mutation(async ({ ctx, input }) => {
    const { sessionEngineArgs } = ctx.requestWorkspace;
    return await controlPlaneChatSessionsController.continuePrompt({
      ...sessionEngineArgs,
      sessionId: input.id,
      apiKey: input.apiKey,
      preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
      leaseOwner: resolveControlPlaneLeaseOwner(ctx),
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
  skills: controlPlaneWorkspaceProcedure.query(async ({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneSkillsController.list(workspace.workspaceRoot, workspace.stateRoot);
  }),
  skillActivate: controlPlaneWorkspaceProcedure.input(skillInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneSkillsController.activate(workspace.workspaceRoot, workspace.stateRoot, input.name);
  }),
  skillDisable: controlPlaneWorkspaceProcedure.input(skillInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneSkillsController.disable(workspace.workspaceRoot, workspace.stateRoot, input.name);
  }),
  browserAutomation: controlPlaneWorkspaceProcedure.query(async ({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneBrowserAutomationController.overview(workspace.workspaceRoot, workspace.stateRoot);
  }),
  browserAutomationSetEnabled: controlPlaneWorkspaceProcedure.input(browserAutomationInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneBrowserAutomationController.setEnabled(workspace.workspaceRoot, workspace.stateRoot, input.enabled);
  }),
  browserAutomationSettingsUpdate: controlPlaneWorkspaceProcedure.input(browserAutomationSettingsInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneBrowserAutomationController.updateSettings(workspace.workspaceRoot, workspace.stateRoot, {
      profileId: input.profileId,
      backend: input.backend,
      channel: input.channel,
      headless: input.headless,
      cdpEndpoint: input.cdpEndpoint,
    });
  }),
  browserAutomationProfileOpen: controlPlaneWorkspaceProcedure.input(browserAutomationProfileOpenInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneBrowserAutomationController.openProfileWindow(workspace.workspaceRoot, workspace.stateRoot, {
      url: input.url,
    });
  }),
  browserAutomationProfileClose: controlPlaneWorkspaceProcedure.input(browserAutomationProfileCloseInputSchema).mutation(async ({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneBrowserAutomationController.closeProfileWindow(workspace.workspaceRoot, workspace.stateRoot);
  }),
  browserAutomationNativeLaunch: controlPlaneWorkspaceProcedure.input(browserAutomationNativeLaunchInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneBrowserAutomationController.launchNativeChrome(workspace.workspaceRoot, workspace.stateRoot, {
      profileId: input.profileId,
      port: input.port,
      url: input.url,
    });
  }),
  browserAutomationNativeStatus: controlPlaneWorkspaceProcedure.input(browserAutomationNativeStatusInputSchema).mutation(async ({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneBrowserAutomationController.nativeChromeStatus(workspace.workspaceRoot, workspace.stateRoot);
  }),
  mcpServers: controlPlaneWorkspaceProcedure.query(async ({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return ControlPlaneMcpController.list(workspace.workspaceRoot, workspace.stateRoot);
  }),
  mcpConfig: controlPlaneWorkspaceProcedure.query(async ({ ctx }) => {
    const { workspace } = ctx.requestWorkspace;
    return ControlPlaneMcpController.config(workspace.workspaceRoot, workspace.stateRoot);
  }),
  mcpConfigSave: controlPlaneWorkspaceProcedure.input(mcpConfigInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return ControlPlaneMcpController.saveConfig(workspace.workspaceRoot, workspace.stateRoot, input.content);
  }),
  mcpServerEnable: controlPlaneWorkspaceProcedure.input(mcpServerInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return ControlPlaneMcpController.enable(workspace.workspaceRoot, workspace.stateRoot, input.serverId);
  }),
  mcpServerDisable: controlPlaneWorkspaceProcedure.input(mcpServerInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return ControlPlaneMcpController.disable(workspace.workspaceRoot, workspace.stateRoot, input.serverId);
  }),
  mcpServerRefresh: controlPlaneWorkspaceProcedure.input(mcpServerInputSchema).mutation(async ({ ctx, input }) => {
    const { workspace } = ctx.requestWorkspace;
    return await ControlPlaneMcpController.refresh(workspace.workspaceRoot, workspace.stateRoot, input.serverId);
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
    const { logger, workspace } = ctx.requestWorkspace;
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
      logger.error({ error, taskId: input.taskId }, 'Failed to run heartbeat task from control plane');
    });

    return {
      accepted: true,
      task,
      run: null,
    };
  }),
  heartbeatRunDueTasks: controlPlaneWorkspaceProcedure.input(heartbeatRunDueTasksInputSchema).mutation(async ({ ctx, input }) => {
    const { logger, workspace } = ctx.requestWorkspace;
    try {
      return await ControlPlaneHeartbeatController.runDueTasks(workspace.stateRoot, {
        ...(input ?? {}),
        workspaceRoot: workspace.workspaceRoot,
        stateDir: workspace.stateRoot,
        preferApiKey: input?.preferApiKey ?? ctx.preferApiKey,
        onEvent: (event) => controlPlaneHeartbeatEventsController.publish({
          workspaceId: workspace.id,
          event,
        }),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to run due heartbeat tasks from control plane');
      throw error;
    }
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

type SessionMessageInput = z.infer<typeof sessionMessageInputSchema>;

function buildSubmitPromptArgs(ctx: ControlPlaneWorkspaceContext, input: SessionMessageInput) {
  const { logger, sessionEngineArgs } = ctx.requestWorkspace;
  const { browserIntent, ...messageInput } = input;
  return {
    ...messageInput,
    ...sessionEngineArgs,
    preferApiKey: input.preferApiKey ?? ctx.preferApiKey,
    systemContext: BrowserAutomationIntentContextService.append({
      intent: browserIntent,
      systemContext: input.systemContext,
    }),
    logger,
    leaseOwner: resolveControlPlaneLeaseOwner(ctx),
  };
}

function resolveControlPlaneLeaseOwner(ctx: Pick<HeddleServerContext, 'runtimeHost'>): ChatSessionLeaseOwner {
  return {
    ownerKind: 'daemon',
    ownerId: ctx.runtimeHost?.serverId ?? `daemon-${process.pid}`,
    clientLabel: 'control plane',
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
