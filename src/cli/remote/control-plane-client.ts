import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import { createControlPlaneProxyClient } from '@/client-shared/api/proxy.js';

export function createDaemonControlPlaneClient(host: Extract<ResolvedRuntimeHost, { kind: 'daemon' }>) {
  return createControlPlaneProxyClient({
    url: `http://${host.endpoint.host}:${host.endpoint.port}/trpc`,
  });
}
