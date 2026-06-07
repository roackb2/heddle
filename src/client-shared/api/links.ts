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
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: httpSubscriptionLink({ url, EventSource: eventSource }),
        // Only request/response operations use the timeout link. Subscriptions
        // are long-lived event streams, so timing them out would disconnect live
        // session updates even when the control plane is healthy.
        false: [
          createControlPlaneRequestTimeoutLink({ defaultTimeoutMs: requestTimeoutMs }),
          requestLink,
        ],
      }),
    ];
  }
}

// Per-operation timeout override for intentionally long request/response calls
// such as slash commands that may compact or summarize a large conversation.
export function createControlPlaneRequestContext({
  timeoutMs,
}: {
  timeoutMs: number;
}): OperationContext {
  return {
    [CONTROL_PLANE_REQUEST_TIMEOUT_CONTEXT_KEY]: timeoutMs,
  };
}

// Applies a client-side timeout to finite control-plane requests. This is kept
// as a tRPC link so every shared API consumer gets the same timeout behavior
// without duplicating host-specific fetch or command handling.
export function createControlPlaneRequestTimeoutLink({
  defaultTimeoutMs = DEFAULT_CONTROL_PLANE_REQUEST_TIMEOUT_MS,
}: {
  defaultTimeoutMs?: number;
} = {}): TRPCLink<AppRouter> {
  return () => ({ op, next }) => observable((observer) => {
    // Defensive guard: this link should only be installed on the request branch,
    // but subscriptions must never inherit finite request timeouts.
    if (op.type === 'subscription') {
      return next(op).subscribe(observer);
    }

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

// Reads the operation override set by createControlPlaneRequestContext and
// falls back to the shared default resolved at link creation time.
function resolveControlPlaneRequestTimeoutMs(
  op: Operation,
  defaultTimeoutMs: number,
): number {
  const candidate = op.context[CONTROL_PLANE_REQUEST_TIMEOUT_CONTEXT_KEY];
  return typeof candidate === 'number' ? candidate : defaultTimeoutMs;
}

// Fetch-level timeout for request transports that need AbortSignal support.
// It preserves upstream cancellation reasons so tRPC/client callers can still
// distinguish caller cancellation from a control-plane timeout.
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
