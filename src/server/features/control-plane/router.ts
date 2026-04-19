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
import { loadControlPlaneState } from './services/control-plane-state.js';
import { listControlPlaneHeartbeatRuns, listControlPlaneHeartbeatTasks } from './services/heartbeat.js';
import { saveControlPlaneLayoutSnapshot } from './services/layout-snapshots.js';
import { searchWorkspaceFiles } from './services/workspace-files.js';

const sessionInputSchema = z.object({
  id: z.string().min(1),
});

const createSessionInputSchema = z.object({
  name: z.string().min(1).optional(),
}).optional();

const sessionMessageInputSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1),
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

const fileSearchInputSchema = z.object({
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).optional();

const layoutSnapshotInputSchema = z.object({
  snapshot: z.unknown(),
});

export const controlPlaneRouter = router({
  state: procedure.query(async ({ ctx }) => {
    return await loadControlPlaneState(ctx);
  }),
  sessions: procedure.query(({ ctx }) => {
    return {
      sessions: readChatSessionViews(resolve(ctx.stateRoot, 'chat-sessions.catalog.json')),
    };
  }),
  sessionCreate: procedure.input(createSessionInputSchema).mutation(({ ctx, input }) => {
    return createControlPlaneChatSession({
      sessionStoragePath: resolve(ctx.stateRoot, 'chat-sessions.catalog.json'),
      suggestedName: input?.name,
    });
  }),
  session: procedure.input(sessionInputSchema).query(({ ctx, input }) => {
    return readChatSessionDetail(resolve(ctx.stateRoot, 'chat-sessions.catalog.json'), input.id) ?? null;
  }),
  modelOptions: procedure.query(() => {
    return {
      groups: BUILT_IN_MODEL_GROUPS,
    };
  }),
  sessionSettingsUpdate: procedure.input(sessionSettingsInputSchema).mutation(({ ctx, input }) => {
    return updateControlPlaneChatSessionSettings({
      sessionStoragePath: resolve(ctx.stateRoot, 'chat-sessions.catalog.json'),
      sessionId: input.id,
      model: input.model,
      driftEnabled: input.driftEnabled,
    });
  }),
  sessionTurnReview: procedure.input(turnReviewInputSchema).query(({ ctx, input }) => {
    return readChatTurnReview(resolve(ctx.stateRoot, 'chat-sessions.catalog.json'), input.sessionId, input.turnId) ?? null;
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
      workspaceRoot: ctx.workspaceRoot,
      stateRoot: ctx.stateRoot,
      sessionStoragePath: resolve(ctx.stateRoot, 'chat-sessions.catalog.json'),
      sessionId: input.sessionId,
      prompt: input.prompt,
    });
  }),
  sessionContinue: procedure.input(sessionInputSchema).mutation(async ({ ctx, input }) => {
    return await continueChatPrompt({
      workspaceRoot: ctx.workspaceRoot,
      stateRoot: ctx.stateRoot,
      sessionStoragePath: resolve(ctx.stateRoot, 'chat-sessions.catalog.json'),
      sessionId: input.id,
    });
  }),
  heartbeatTasks: procedure.query(async ({ ctx }) => {
    return {
      tasks: await listControlPlaneHeartbeatTasks(ctx.stateRoot),
    };
  }),
  heartbeatRuns: procedure.input(heartbeatRunsInputSchema).query(async ({ ctx, input }) => {
    return {
      runs: await listControlPlaneHeartbeatRuns(ctx.stateRoot, {
        taskId: input?.taskId,
        limit: input?.limit ?? 20,
      }),
    };
  }),
  workspaceFileSearch: procedure.input(fileSearchInputSchema).query(async ({ ctx, input }) => {
    return {
      files: await searchWorkspaceFiles({
        workspaceRoot: ctx.workspaceRoot,
        query: input?.query ?? '',
        limit: input?.limit ?? 20,
      }),
    };
  }),
  layoutSnapshotSave: procedure.input(layoutSnapshotInputSchema).mutation(async ({ ctx, input }) => {
    return await saveControlPlaneLayoutSnapshot(ctx.stateRoot, input.snapshot);
  }),
});
