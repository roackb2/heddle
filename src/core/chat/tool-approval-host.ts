import type { ToolCall, ToolDefinition } from '../../index.js';

export type ToolApprovalDecision = { approved: boolean; reason?: string };

export type PendingToolApprovalView = {
  tool: string;
  callId: string;
  input: unknown;
  requestedAt: string;
};

export function requestToolApproval(args: {
  call: ToolCall;
  tool: ToolDefinition;
  createView?: (call: ToolCall, tool: ToolDefinition) => PendingToolApprovalView;
  publish?: (view: PendingToolApprovalView, call: ToolCall, tool: ToolDefinition) => void;
  storePending?: (pending: { view: PendingToolApprovalView; resolve: (decision: ToolApprovalDecision) => void }) => void;
}): Promise<ToolApprovalDecision> {
  const view =
    args.createView?.(args.call, args.tool)
    ?? {
      tool: args.tool.name,
      callId: args.call.id,
      input: args.call.input,
      requestedAt: new Date().toISOString(),
    };

  return new Promise<ToolApprovalDecision>((resolve) => {
    args.storePending?.({ view, resolve });
    args.publish?.(view, args.call, args.tool);
  });
}
