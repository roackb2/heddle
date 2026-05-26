import { createTRPCProxyClient } from '@trpc/client';
import type { AppRouter } from '@/server/router.js';
import { createControlPlaneTrpcLinks } from './links.js';

export type CreateControlPlaneProxyClientOptions = {
  url: string;
  batch?: boolean;
};

export function createControlPlaneProxyClient({
  url,
  batch = true,
}: CreateControlPlaneProxyClientOptions) {
  return createTRPCProxyClient<AppRouter>({
    links: createControlPlaneTrpcLinks({ url, batch }),
  });
}

export type ControlPlaneProxyClient = ReturnType<typeof createControlPlaneProxyClient>;
