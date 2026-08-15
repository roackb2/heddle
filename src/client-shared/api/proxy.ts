import type { EventSource } from 'eventsource';
import { createTRPCProxyClient } from '@trpc/client';
import type { AppRouter } from '@heddleagent/runtime/cli';
import { ClientSharedApiLinkService } from './links.js';

export type CreateControlPlaneProxyClientOptions = {
  url: string;
  batch?: boolean;
  eventSource?: typeof EventSource;
};

/**
 * Non-React API client service for terminal and programmatic consumers.
 *
 * The service owns proxy client construction so CLI, TUI, and ask mode share the
 * same tRPC transport behavior instead of maintaining separate factories.
 */
export class ClientSharedProxyApiService {
  static createClient({
    url,
    batch = true,
    eventSource,
  }: CreateControlPlaneProxyClientOptions) {
    return createTRPCProxyClient<AppRouter>({
      links: ClientSharedApiLinkService.create({ url, batch, eventSource }),
    });
  }
}

export type ControlPlaneProxyClient = ReturnType<typeof ClientSharedProxyApiService.createClient>;
