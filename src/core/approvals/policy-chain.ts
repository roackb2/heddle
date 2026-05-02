import type {
  ToolApprovalDecision,
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

export type ResolveToolApprovalArgs = {
  policies: ToolApprovalPolicy[];
  context: ToolApprovalPolicyContext;
  requestHumanApproval?: (context: ToolApprovalPolicyContext, reason?: string) => Promise<ToolApprovalDecision>;
};

export async function resolveToolApproval(args: ResolveToolApprovalArgs): Promise<ToolApprovalDecision> {
  let requestReason: string | undefined;

  for (const policy of args.policies) {
    const decision = await policy(args.context);
    if (!decision) {
      continue;
    }

    if (decision.type === 'deny') {
      return { approved: false, reason: decision.reason };
    }

    if (decision.type === 'allow') {
      return { approved: true, reason: decision.reason };
    }

    requestReason ??= decision.reason;
  }

  if (!requestReason) {
    return { approved: true };
  }

  if (!args.requestHumanApproval) {
    return {
      approved: false,
      reason: `No approval handler configured for ${args.context.call.tool}${requestReason ? `: ${requestReason}` : ''}`,
    };
  }

  return args.requestHumanApproval(args.context, requestReason);
}
