import type { ToolCall, ToolDefinition } from '../types.js';

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
