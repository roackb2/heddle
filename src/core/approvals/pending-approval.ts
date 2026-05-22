import type { RequestPendingToolApprovalArgs, ToolApprovalUserDecision } from './types.js';

/**
 * Owns the host-neutral pending approval primitive.
 *
 * Hosts provide publishing and pending-state storage. Core only creates the
 * view payload and returns the promise resolved by the host.
 */
export class PendingToolApprovalRequests {
  static request(args: RequestPendingToolApprovalArgs): Promise<ToolApprovalUserDecision> {
    return new Promise<ToolApprovalUserDecision>((resolve) => {
      args.storePending?.({ request: args.request, resolve });
    });
  }
}
