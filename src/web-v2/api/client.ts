import {
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/router';

const trpcLinks = [
  splitLink({
    condition: (operation) => operation.type === 'subscription',
    true: httpSubscriptionLink({
      url: '/trpc',
    }),
    false: httpBatchLink({
      url: '/trpc',
    }),
  }),
];

export const trpcReact = createTRPCReact<AppRouter>();

export function createControlPlaneTrpcClient() {
  return trpcReact.createClient({
    links: trpcLinks,
  });
}

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
type AsyncIterableValue<T> = T extends AsyncIterable<infer Value> ? Value : T;
export type ControlPlaneState = RouterOutputs['controlPlane']['state'];
export type ControlPlaneSessionDetail = RouterOutputs['controlPlane']['session'];
export type ControlPlaneSessionEventEnvelope = AsyncIterableValue<RouterOutputs['controlPlane']['sessionEvents']>;
export type ControlPlaneSessionMessage = NonNullable<ControlPlaneSessionDetail>['messages'][number];
export type ControlPlanePendingApproval = RouterOutputs['controlPlane']['sessionPendingApproval'];
export type ControlPlaneApprovalDecision = RouterInputs['controlPlane']['sessionResolveApproval']['decision'];
export type ControlPlaneSessionSendPromptResult = RouterOutputs['controlPlane']['sessionSendPrompt'];
export type ControlPlaneModelOptions = RouterOutputs['controlPlane']['modelOptions'];
export type ControlPlaneSessionSettingsInput = RouterInputs['controlPlane']['sessionSettingsUpdate'];
export type ControlPlaneWorkspaceChanges = RouterOutputs['controlPlane']['workspaceChanges'];
export type ControlPlaneWorkspaceChangedFile = ControlPlaneWorkspaceChanges['files'][number];
export type ControlPlaneWorkspaceFileDiff = RouterOutputs['controlPlane']['workspaceFileDiff'];
