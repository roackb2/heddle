import { useState } from 'react';
import { ClientSharedApiLinkService } from './links.js';
import { trpcReact } from './react.js';

export type UseControlPlaneTrpcClientOptions = {
  url?: string;
};

/**
 * React hook for creating the stable tRPC client instance used by providers.
 *
 * Keep React lifecycle/state ownership in hook form; non-React API construction
 * stays in service classes under this shared client boundary.
 */
export function useControlPlaneTrpcClient(options: UseControlPlaneTrpcClientOptions = {}) {
  const [client] = useState(() => trpcReact.createClient({
    links: ClientSharedApiLinkService.create({
      url: options.url ?? '/trpc',
    }),
  }));

  return client;
}
