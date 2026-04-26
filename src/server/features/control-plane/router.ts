import { resolve } from 'node:path';
import { z } from 'zod';
import { BUILT_IN_MODEL_GROUPS } from '../../../core/llm/openai-models.js';
import { procedure, router } from '../../trpc.js';
import {
  cancelControlPlaneSessionRun,
  continueChatPrompt,
  createControlPlaneChatSession,
  getPendingControlPlaneApproval,
  isControlPlaneSessionRunning,
  readChatSessionDetail,
  readChatSessionViews,
  readChatTurnReview,
  resolvePendingControlPlaneApproval,
  submitChatPrompt,
  updateControlPlaneChatSessionSettings,
} from './services/chat-sessions.js';
import { runControlPlaneAsk } from './services/ask.js';
import { loadControlPlaneState } from './services/control-plane-state.js';
import {
  listControlPlaneHeartbeatRuns,
  listControlPlaneHeartbeatTasks,
  setControlPlaneHeartbeatTaskEnabled,
  triggerControlPlaneHeartbeatTaskRun,
} from './services/heartbeat.js';
import {
  listControlPlaneMemoryNotes,
  readControlPlaneMemoryNote,
  readControlPlaneMemoryStatus,
  searchControlPlaneMemoryNotes,
} from './services/memory.js';
import { saveControlPlaneLayoutSnapshot } from './services/layout-snapshots.js';
import { browseWorkspaceDirectories, searchWorkspaceFiles } from './services/workspace-files.js';
import { createWorkspaceDescriptor, setActiveWorkspace } from '../../../core/runtime/workspaces.js';

const sessionInputSchema = z.object({
  id: z.string().min(1),
  apiKey: z.string().min(1).optional(),
});

const createSessionInputSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  apiKeyPresent: z.boolean().optional(),
}).optional();

const sessionMessageInputSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  systemContext: z.string().min(1).optional(),
  memoryMaintenanceMode: z.enum(['background', 'inline', 'none']).optional(),
});

const agentAskInputSchema = z.object({
  goal: z.string().min(1),
  model: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(500).optional(),
  apiKey: z.string().min(1).optional(),
  searchIgnoreDirs: z.array(z.string().min(1)).optional(),
  systemContext: z.string().min(1).optional(),
});

const turnReviewInputSchema = z.object({
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
});

const sessionApprovalDecisionSchema = z.object({
  sessionId: z.string().min(1),
  approved: z.boolean(),
  reason: z.string().optional(),
});

const sessionSettingsInputSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1).optional(),
  driftEnabled: z.boolean().optional(),
});

const heartbeatRunsInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).optional();

const heartbeatTaskInputSchema = z.object({
  taskId: z.string().min(1),
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

export const controlPlaneRouter = router({
  state: procedure.query(async ({ ctx }) => {
    return await loadControlPlaneState(ctx);
  }),
  sessions: procedure.query(({ ctx }) => {
    return {
      sessions: readChatSessionViews(resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json')),
    };
  }),
  sessionCreate: procedure.input(createSessionInputSchema).mutation(({ ctx, input }) => {
    return createControlPlaneChatSession({
      sessionStoragePath: resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json'),
      suggestedName: input?.name,
      workspaceId: ctx.activeWorkspace.id,
      model: input?.model,
      apiKeyPresent: input?.apiKeyPresent,
    });
  }),
  session: procedure.input(sessionInputSchema).query(({ ctx, input }) => {
    return readChatSessionDetail(resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json'), input.id) ?? null;
  }),
  modelOptions: procedure.query(() => {
    return {
      groups: BUILT_IN_MODEL_GROUPS,
    };
  }),
  sessionSettingsUpdate: procedure.input(sessionSettingsInputSchema).mutation(({ ctx, input }) => {
    return updateControlPlaneChatSessionSettings({
      sessionStoragePath: resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json'),
      sessionId: input.id,
      model: input.model,
      driftEnabled: input.driftEnabled,
    });
  }),
  sessionTurnReview: procedure.input(turnReviewInputSchema).query(({ ctx, input }) => {
    return readChatTurnReview(resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json'), input.sessionId, input.turnId) ?? null;
  }),
  sessionPendingApproval: procedure.input(sessionInputSchema).query(({ input }) => {
    return getPendingControlPlaneApproval(input.id) ?? null;
  }),
  sessionRunning: procedure.input(sessionInputSchema).query(({ input }) => {
    return { running: isControlPlaneSessionRunning(input.id) };
  }),
  sessionResolveApproval: procedure.input(sessionApprovalDecisionSchema).mutation(({ input }) => {
    return {
      resolved: resolvePendingControlPlaneApproval(input.sessionId, {
        approved: input.approved,
        reason: input.reason,
      }),
    };
  }),
  sessionCancel: procedure.input(sessionInputSchema).mutation(({ input }) => {
    return {
      cancelled: cancelControlPlaneSessionRun(input.id),
    };
  }),
  sessionSendPrompt: procedure.input(sessionMessageInputSchema).mutation(async ({ ctx, input }) => {
    return await submitChatPrompt({
      workspaceRoot: ctx.activeWorkspace.anchorRoot,
      stateRoot: ctx.activeWorkspace.stateRoot,
      sessionStoragePath: resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json'),
      sessionId: input.sessionId,
      prompt: input.prompt,
      apiKey: input.apiKey,
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
    return await continueChatPrompt({
      workspaceRoot: ctx.activeWorkspace.anchorRoot,
      stateRoot: ctx.activeWorkspace.stateRoot,
      sessionStoragePath: resolve(ctx.activeWorkspace.stateRoot, 'chat-sessions.catalog.json'),
      sessionId: input.id,
      apiKey: input.apiKey,
      leaseOwner: {
        ownerKind: 'daemon',
        ownerId: ctx.runtimeHost?.ownerId ?? `daemon-${process.pid}`,
        clientLabel: 'control plane',
      },
    });
  }),
  agentAsk: procedure.input(agentAskInputSchema).mutation(async ({ ctx, input }) => {
    return await runControlPlaneAsk({
      goal: input.goal,
      workspaceRoot: ctx.activeWorkspace.anchorRoot,
      stateRoot: ctx.activeWorkspace.stateRoot,
      model: input.model,
      maxSteps: input.maxSteps,
      apiKey: input.apiKey,
      searchIgnoreDirs: input.searchIgnoreDirs,
      systemContext: input.systemContext,
    });
  }),
  heartbeatTasks: procedure.query(async ({ ctx }) => {
    return {
      tasks: await listControlPlaneHeartbeatTasks(ctx.activeWorkspace.stateRoot),
    };
  }),
  heartbeatRuns: procedure.input(heartbeatRunsInputSchema).query(async ({ ctx, input }) => {
    return {
      runs: await listControlPlaneHeartbeatRuns(ctx.activeWorkspace.stateRoot, {
        taskId: input?.taskId,
        limit: input?.limit ?? 20,
      }),
    };
  }),
  memoryStatus: procedure.query(async ({ ctx }) => {
    return await readControlPlaneMemoryStatus(ctx.activeWorkspace.stateRoot);
  }),
  memoryList: procedure.input(memoryListInputSchema).query(async ({ ctx, input }) => {
    return await listControlPlaneMemoryNotes(ctx.activeWorkspace.stateRoot, input?.path);
  }),
  memoryRead: procedure.input(memoryReadInputSchema).query(async ({ ctx, input }) => {
    return await readControlPlaneMemoryNote(ctx.activeWorkspace.stateRoot, input.path, {
      offset: input.offset,
      maxLines: input.maxLines,
    });
  }),
  memorySearch: procedure.input(memorySearchInputSchema).query(async ({ ctx, input }) => {
    return await searchControlPlaneMemoryNotes(ctx.activeWorkspace.stateRoot, input.query, {
      path: input.path,
      maxResults: input.maxResults,
    });
  }),
  heartbeatTaskEnable: procedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    return {
      task: await setControlPlaneHeartbeatTaskEnabled(ctx.activeWorkspace.stateRoot, input.taskId, true),
    };
  }),
  heartbeatTaskDisable: procedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    return {
      task: await setControlPlaneHeartbeatTaskEnabled(ctx.activeWorkspace.stateRoot, input.taskId, false),
    };
  }),
  heartbeatTaskTrigger: procedure.input(heartbeatTaskInputSchema).mutation(async ({ ctx, input }) => {
    return {
      task: await triggerControlPlaneHeartbeatTaskRun(ctx.activeWorkspace.stateRoot, input.taskId),
    };
  }),
  workspaceFileSearch: procedure.input(fileSearchInputSchema).query(async ({ ctx, input }) => {
    return {
      files: await searchWorkspaceFiles({
        workspaceRoot: ctx.activeWorkspace.anchorRoot,
        query: input?.query ?? '',
        limit: input?.limit ?? 20,
      }),
    };
  }),
  workspaceBrowse: procedure.input(workspaceBrowseInputSchema).query(async ({ input }) => {
    return await browseWorkspaceDirectories({
      path: input?.path,
      limit: input?.limit ?? 100,
      includeHidden: input?.includeHidden ?? false,
    });
  }),
  workspaceSetActive: procedure.input(workspaceSetActiveInputSchema).mutation(({ ctx, input }) => {
    const resolved = setActiveWorkspace({
      workspaceRoot: ctx.workspaceRoot,
      stateRoot: ctx.stateRoot,
      workspaceId: input.workspaceId,
    });
    return {
      activeWorkspaceId: resolved.activeWorkspaceId,
      workspace: resolved.activeWorkspace,
      workspaces: resolved.workspaces,
    };
  }),
  workspaceCreate: procedure.input(workspaceCreateInputSchema).mutation(({ ctx, input }) => {
    const resolved = createWorkspaceDescriptor({
      workspaceRoot: ctx.workspaceRoot,
      stateRoot: ctx.stateRoot,
      name: input.name,
      anchorRoot: input.anchorRoot,
      repoRoots: input.repoRoots,
      setActive: input.setActive,
    });
    return {
      activeWorkspaceId: resolved.activeWorkspaceId,
      workspace: resolved.activeWorkspace,
      workspaces: resolved.workspaces,
    };
  }),
  layoutSnapshotSave: procedure.input(layoutSnapshotInputSchema).mutation(async ({ ctx, input }) => {
    return await saveControlPlaneLayoutSnapshot(ctx.activeWorkspace.stateRoot, input.snapshot);
  }),
});
