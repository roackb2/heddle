import type { ToolCall, ToolDefinition } from '@/core/types.js';
import type { RequestPendingToolApprovalArgs, ToolApprovalDecision, PendingToolApprovalView } from './types.js';

/**
 * Owns the host-neutral pending approval primitive.
 *
 * Hosts provide publishing and pending-state storage. Core only creates the
 * view payload and returns the promise resolved by the host.
 */
export class PendingToolApprovalRequests {
  static request(args: RequestPendingToolApprovalArgs): Promise<ToolApprovalDecision> {
    const view = args.createView?.(args.call, args.tool) ?? PendingToolApprovalRequests.createDefaultView({
      call: args.call,
      tool: args.tool,
    });

    return new Promise<ToolApprovalDecision>((resolve) => {
      args.storePending?.({ view, resolve });
      args.publish?.(view, args.call, args.tool);
    });
  }

  static createDefaultView(args: {
    call: ToolCall;
    tool: ToolDefinition;
    now?: () => Date;
  }): PendingToolApprovalView {
    return {
      tool: args.tool.name,
      callId: args.call.id,
      input: args.call.input,
      requestedAt: (args.now ?? (() => new Date()))().toISOString(),
    };
  }
}
