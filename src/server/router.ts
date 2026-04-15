import { procedure, router } from './trpc.js';
import { controlPlaneRouter } from './features/control-plane/router.js';

export const appRouter = router({
  health: procedure.query(({ ctx }) => {
    return {
      ok: true,
      service: 'heddle-server',
      workspaceRoot: ctx.workspaceRoot,
      stateRoot: ctx.stateRoot,
    };
  }),
  controlPlane: controlPlaneRouter,
});

export type AppRouter = typeof appRouter;
