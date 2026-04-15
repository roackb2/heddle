import { resolve } from 'node:path';
import { z } from 'zod';
import { procedure, router } from '../../trpc.js';
import { readChatSessionDetail, readChatSessionViews, readChatTurnReview } from './services/chat-sessions.js';
import { loadControlPlaneState } from './services/control-plane-state.js';
import { listControlPlaneHeartbeatRuns, listControlPlaneHeartbeatTasks } from './services/heartbeat.js';

const sessionInputSchema = z.object({
  id: z.string().min(1),
});

const turnReviewInputSchema = z.object({
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
});

const heartbeatRunsInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).optional();

export const controlPlaneRouter = router({
  state: procedure.query(async ({ ctx }) => {
    return await loadControlPlaneState(ctx);
  }),
  sessions: procedure.query(({ ctx }) => {
    return {
      sessions: readChatSessionViews(resolve(ctx.stateRoot, 'chat-sessions.json')),
    };
  }),
  session: procedure.input(sessionInputSchema).query(({ ctx, input }) => {
    return readChatSessionDetail(resolve(ctx.stateRoot, 'chat-sessions.json'), input.id) ?? null;
  }),
  sessionTurnReview: procedure.input(turnReviewInputSchema).query(({ ctx, input }) => {
    return readChatTurnReview(resolve(ctx.stateRoot, 'chat-sessions.json'), input.sessionId, input.turnId) ?? null;
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
});
