import type {
  EvaluateToolApprovalPoliciesArgs,
  ResolveToolApprovalArgs,
  ToolApprovalDecision,
  ToolApprovalPolicyDecision,
} from './types.js';

/**
 * Owns ordered approval-policy resolution for one tool call.
 *
 * Policies may allow, deny, request a human decision, or abstain. This service
 * preserves that policy-chain behavior without owning host UI or remembered
 * approval storage.
 */
export class ToolApprovalService {
  static async evaluate(args: EvaluateToolApprovalPoliciesArgs): Promise<ToolApprovalPolicyDecision | undefined> {
    for (const policy of args.policies) {
      const decision = await policy(args.context);
      if (decision) {
        return decision;
      }
    }

    return undefined;
  }

  static async resolve(args: ResolveToolApprovalArgs): Promise<ToolApprovalDecision> {
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
}
