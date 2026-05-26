import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@/server/router.js';
import { createControlPlaneTrpcLinks } from './links.js';

export const trpcReact = createTRPCReact<AppRouter>();

export type CreateControlPlaneReactClientOptions = {
  url?: string;
};

export function createControlPlaneTrpcClient(options: CreateControlPlaneReactClientOptions = {}) {
  return trpcReact.createClient({
    links: createControlPlaneTrpcLinks({
      url: options.url ?? '/trpc',
    }),
  });
}
