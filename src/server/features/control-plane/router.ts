import { resolve } from 'node:path';
import { z } from 'zod';
import { procedure, router } from '../../trpc.js';
import { readChatSessionViews } from './services/chat-sessions.js';
import { loadControlPlaneState } from './services/control-plane-state.js';
import { listControlPlaneHeartbeatRuns, listControlPlaneHeartbeatTasks } from './services/heartbeat.js';

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
