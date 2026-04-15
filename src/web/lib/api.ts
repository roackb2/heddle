import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../server/router';

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/trpc',
    }),
  ],
});

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type ControlPlaneState = RouterOutputs['controlPlane']['state'];

export async function fetchControlPlaneState(): Promise<ControlPlaneState> {
  return await trpc.controlPlane.state.query();
}
