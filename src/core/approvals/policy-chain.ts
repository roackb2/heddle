import type {
  ToolApprovalPolicy,
  ToolApprovalPolicyContext,
  ToolApprovalPolicyDecision,
} from './types.js';

export async function evaluateToolApprovalPolicies(
  policies: ToolApprovalPolicy[],
  context: ToolApprovalPolicyContext,
): Promise<ToolApprovalPolicyDecision | undefined> {
  for (const policy of policies) {
    const decision = await policy(context);
    if (decision) {
      return decision;
    }
  }

  return undefined;
}
