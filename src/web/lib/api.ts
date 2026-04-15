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
export type ChatSessionDetail = RouterOutputs['controlPlane']['session'];
export type ChatTurnReview = RouterOutputs['controlPlane']['sessionTurnReview'];
export type SessionSendPromptResult = RouterOutputs['controlPlane']['sessionSendPrompt'];

export async function fetchControlPlaneState(): Promise<ControlPlaneState> {
  return await trpc.controlPlane.state.query();
}

export async function fetchChatSessionDetail(sessionId: string): Promise<ChatSessionDetail> {
  return await trpc.controlPlane.session.query({ id: sessionId });
}

export async function fetchChatTurnReview(sessionId: string, turnId: string): Promise<ChatTurnReview> {
  return await trpc.controlPlane.sessionTurnReview.query({ sessionId, turnId });
}

export async function sendChatSessionPrompt(sessionId: string, prompt: string): Promise<SessionSendPromptResult> {
  return await trpc.controlPlane.sessionSendPrompt.mutate({ sessionId, prompt });
}
