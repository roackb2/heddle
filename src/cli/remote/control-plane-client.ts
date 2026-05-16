import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../server/router.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';

export function createDaemonControlPlaneClient(host: Extract<ResolvedRuntimeHost, { kind: 'daemon' }>) {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${host.endpoint.host}:${host.endpoint.port}/trpc`,
      }),
    ],
  });
}
