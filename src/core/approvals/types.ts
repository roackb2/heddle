import type { ToolCall, ToolDefinition } from '@/core/types.js';
import type { EditFilePreview } from '@/core/tools/toolkits/coding-files/edit-file.js';
import type { ProjectApprovalRule } from './remembered-rules/index.js';
import type { AutonomyEvaluation } from './autonomy/index.js';

export type ToolApprovalDecision = { approved: boolean; reason?: string; autonomyEvaluation?: AutonomyEvaluation };

export type ToolApprovalUserDecision =
  | { type: 'approve'; reason?: string }
  | { type: 'deny'; reason?: string }
  | { type: 'approve_and_remember_project'; reason?: string };

export type ToolApprovalPolicyDecision =
  | { type: 'allow'; reason?: string; autonomyEvaluation?: AutonomyEvaluation }
  | { type: 'deny'; reason?: string; autonomyEvaluation?: AutonomyEvaluation }
  | { type: 'request'; reason?: string; autonomyEvaluation?: AutonomyEvaluation };

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

export type ToolApprovalRequest = {
  tool: string;
  callId: string;
  input: unknown;
  requestedAt: string;
  summary: string;
  reason?: string;
  editPreview?: EditFilePreview;
  rememberProjectApproval?: {
    label: string;
    rule: ProjectApprovalRule;
  };
};

export type RequestToolApprovalThroughServiceArgs = ToolApprovalPolicyContext & {
  reason?: string;
  storePending?: (pending: { request: ToolApprovalRequest; resolve: (decision: ToolApprovalUserDecision) => void }) => void;
};
