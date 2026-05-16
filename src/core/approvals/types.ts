import type { ToolCall, ToolDefinition } from '@/core/types.js';

export type ToolApprovalDecision = { approved: boolean; reason?: string };

export type ToolApprovalPolicyDecision =
  | { type: 'allow'; reason?: string }
  | { type: 'deny'; reason?: string }
  | { type: 'request'; reason?: string };

export type ToolApprovalPolicyContext = {
  call: ToolCall;
  tool: ToolDefinition;
  workspaceRoot?: string;
};

export type ToolApprovalPolicy = (
  context: ToolApprovalPolicyContext,
) => ToolApprovalPolicyDecision | undefined | Promise<ToolApprovalPolicyDecision | undefined>;

export type ToolApprovalSurface = (
  context: ToolApprovalPolicyContext,
) => Promise<ToolApprovalDecision>;

export type EvaluateToolApprovalPoliciesArgs = {
  policies: ToolApprovalPolicy[];
  context: ToolApprovalPolicyContext;
};

export type ResolveToolApprovalArgs = EvaluateToolApprovalPoliciesArgs & {
  requestHumanApproval?: (context: ToolApprovalPolicyContext, reason?: string) => Promise<ToolApprovalDecision>;
};

export type PendingToolApprovalView = {
  tool: string;
  callId: string;
  input: unknown;
  requestedAt: string;
};

export type RequestPendingToolApprovalArgs = {
  call: ToolCall;
  tool: ToolDefinition;
  createView?: (call: ToolCall, tool: ToolDefinition) => PendingToolApprovalView;
  publish?: (view: PendingToolApprovalView, call: ToolCall, tool: ToolDefinition) => void;
  storePending?: (pending: { view: PendingToolApprovalView; resolve: (decision: ToolApprovalDecision) => void }) => void;
};
