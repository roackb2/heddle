import {
  httpBatchLink,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  type TRPCLink,
} from '@trpc/client';
import type { EventSource } from 'eventsource';
import type { AppRouter } from '@/server/router.js';

export type CreateControlPlaneTrpcLinksOptions = {
  url: string;
  batch?: boolean;
  eventSource?: typeof EventSource;
  requestTimeoutMs?: number;
};

const DEFAULT_CONTROL_PLANE_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Shared tRPC link service for frontend API consumers.
 *
 * Owns the transport split between subscriptions and request/response calls so
 * web-v2, TUI, and CLI callers do not each rebuild link policy.
 */
export class ClientSharedApiLinkService {
  static create({
    url,
    batch = false,
    eventSource,
    requestTimeoutMs = DEFAULT_CONTROL_PLANE_REQUEST_TIMEOUT_MS,
  }: CreateControlPlaneTrpcLinksOptions): TRPCLink<AppRouter>[] {
    const fetch = createControlPlaneRequestFetch({ timeoutMs: requestTimeoutMs });
    const requestLink = batch ? httpBatchLink({ url, fetch }) : httpLink({ url, fetch });

    return [
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: httpSubscriptionLink({ url, EventSource: eventSource }),
        false: requestLink,
      }),
    ];
  }
}

export function createControlPlaneRequestFetch({
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_CONTROL_PLANE_REQUEST_TIMEOUT_MS,
}: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetchImpl;
  }

  return async (input, init) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Control-plane request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const abortFromUpstream = () => {
      controller.abort(upstreamSignal?.reason ?? new Error('Control-plane request aborted.'));
    };

    if (upstreamSignal?.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
    }

    try {
      return await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    }
  };
}
