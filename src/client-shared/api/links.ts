import {
  httpBatchLink,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  type TRPCLink,
} from '@trpc/client';
import type { AppRouter } from '@/server/router.js';

export type CreateControlPlaneTrpcLinksOptions = {
  url: string;
  batch?: boolean;
};

export function createControlPlaneTrpcLinks({
  url,
  batch = false,
}: CreateControlPlaneTrpcLinksOptions): TRPCLink<AppRouter>[] {
  const requestLink = batch ? httpBatchLink({ url }) : httpLink({ url });

  return [
    splitLink({
      condition: (operation) => operation.type === 'subscription',
      true: httpSubscriptionLink({ url }),
      false: requestLink,
    }),
  ];
}
