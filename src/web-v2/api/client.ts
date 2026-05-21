import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/router';

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/trpc',
    }),
  ],
});

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type ControlPlaneState = RouterOutputs['controlPlane']['state'];
export type ControlPlaneSessionDetail = RouterOutputs['controlPlane']['session'];
export type ControlPlaneSessionMessage = NonNullable<ControlPlaneSessionDetail>['messages'][number];
export type ControlPlaneSessionSendPromptResult = RouterOutputs['controlPlane']['sessionSendPrompt'];

export async function sendControlPlaneSessionPrompt(
  sessionId: string,
  prompt: string,
): Promise<ControlPlaneSessionSendPromptResult> {
  return await trpc.controlPlane.sessionSendPrompt.mutate({ sessionId, prompt });
}
