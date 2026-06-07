import {
  httpBatchLink,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
  type Operation,
  type OperationContext,
  type TRPCLink,
} from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { EventSource } from 'eventsource';
import type { AppRouter } from '@/server/router.js';

export type CreateControlPlaneTrpcLinksOptions = {
  url: string;
  batch?: boolean;
  eventSource?: typeof EventSource;
  requestTimeoutMs?: number;
};

const DEFAULT_CONTROL_PLANE_REQUEST_TIMEOUT_MS = 30_000;
export const CONTROL_PLANE_REQUEST_TIMEOUT_CONTEXT_KEY = 'requestTimeoutMs';

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
    const requestLink = batch ? httpBatchLink({ url }) : httpLink({ url });

    return [
      createControlPlaneRequestTimeoutLink({ defaultTimeoutMs: requestTimeoutMs }),
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: httpSubscriptionLink({ url, EventSource: eventSource }),
        false: requestLink,
      }),
    ];
  }
}

export function createControlPlaneRequestContext({
  timeoutMs,
}: {
  timeoutMs: number;
}): OperationContext {
  return {
    [CONTROL_PLANE_REQUEST_TIMEOUT_CONTEXT_KEY]: timeoutMs,
  };
}

export function createControlPlaneRequestTimeoutLink({
  defaultTimeoutMs = DEFAULT_CONTROL_PLANE_REQUEST_TIMEOUT_MS,
}: {
  defaultTimeoutMs?: number;
} = {}): TRPCLink<AppRouter> {
  return () => ({ op, next }) => observable((observer) => {
    const timeoutMs = resolveControlPlaneRequestTimeoutMs(op, defaultTimeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return next(op).subscribe(observer);
    }

    const timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      observer.error(TRPCClientError.from(new Error(`Control-plane request "${op.path}" timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);
    const subscription = next(op).subscribe({
      next: (value) => observer.next(value),
      error: (error) => {
        clearTimeout(timeoutId);
        observer.error(error);
      },
      complete: () => {
        clearTimeout(timeoutId);
        observer.complete();
      },
    });

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  });
}

function resolveControlPlaneRequestTimeoutMs(
  op: Operation,
  defaultTimeoutMs: number,
): number {
  const candidate = op.context[CONTROL_PLANE_REQUEST_TIMEOUT_CONTEXT_KEY];
  return typeof candidate === 'number' ? candidate : defaultTimeoutMs;
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
