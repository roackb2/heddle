import type {
  EvaluateToolApprovalPoliciesArgs,
  RequestToolApprovalThroughServiceArgs,
  ResolveToolApprovalArgs,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolApprovalPolicyDecision,
  ToolApprovalUserDecision,
} from './types.js';
import { PendingToolApprovalRequests } from './pending-approval.js';
import {
  FileProjectApprovalRuleRepository,
  ProjectApprovalRules,
  type ProjectApprovalRule,
} from './remembered-rules/index.js';
import { previewEditFileInput } from '@/core/tools/toolkits/coding-files/edit-file.js';
import { ToolActivitySummarizer } from '@/core/live/index.js';
import type { ToolApprovalPolicyContext } from './types.js';

export type ToolApprovalServiceOptions = {
  workspaceRoot?: string;
  projectApprovalRulesFile?: string;
  now?: () => Date;
};

/**
 * Owns approval policy resolution and shared approval request semantics.
 *
 * Policies may allow, deny, request a human decision, or abstain. This service
 * also creates host-neutral approval requests and owns remembered project
 * approval rule behavior so hosts do not reach into lower-level primitives.
 */
export class ToolApprovalService {
  constructor(private readonly options: ToolApprovalServiceOptions = {}) {}

  static async evaluate(args: EvaluateToolApprovalPoliciesArgs): Promise<ToolApprovalPolicyDecision | undefined> {
    return new ToolApprovalService().evaluate(args);
  }

  static async resolve(args: ResolveToolApprovalArgs): Promise<ToolApprovalDecision> {
    return new ToolApprovalService().resolve(args);
  }

  async evaluate(args: EvaluateToolApprovalPoliciesArgs): Promise<ToolApprovalPolicyDecision | undefined> {
    for (const policy of args.policies) {
      const decision = await policy(args.context);
      if (decision) {
        return decision;
      }
    }

    return undefined;
  }

  async resolve(args: ResolveToolApprovalArgs): Promise<ToolApprovalDecision> {
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

  async requestHumanApproval(args: RequestToolApprovalThroughServiceArgs): Promise<ToolApprovalDecision> {
    const request = await this.createRequest(args);
    const decision = await PendingToolApprovalRequests.request({
      request,
      storePending: args.storePending,
    });
    return this.resolveUserDecision({
      context: args,
      decision,
    });
  }

  async createRequest(args: ToolApprovalPolicyContext & { reason?: string }): Promise<ToolApprovalRequest> {
    const rememberedRule = ProjectApprovalRules.createForCall(args.call);
    const editPreview =
      args.call.tool === 'edit_file'
        ? await previewEditFileInput(args.call.input, this.options.workspaceRoot)
        : undefined;

    return {
      tool: args.tool.name,
      callId: args.call.id,
      input: args.call.input,
      requestedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      summary: ToolActivitySummarizer.summarizeCall(args.call),
      reason: args.reason,
      editPreview,
      rememberProjectApproval: rememberedRule
        ? {
            label: ProjectApprovalRules.describe(rememberedRule),
            rule: rememberedRule,
          }
        : undefined,
    };
  }

  resolveUserDecision(args: {
    context: ToolApprovalPolicyContext;
    decision: ToolApprovalUserDecision;
  }): ToolApprovalDecision {
    if (args.decision.type === 'deny') {
      return {
        approved: false,
        reason: args.decision.reason ?? 'Denied by user',
      };
    }

    if (args.decision.type === 'approve_and_remember_project') {
      this.rememberProjectApproval(args.context);
      return {
        approved: true,
        reason: args.decision.reason ?? 'Approved and remembered for this project',
      };
    }

    return {
      approved: true,
      reason: args.decision.reason ?? 'Approved by user',
    };
  }

  rememberProjectApproval(context: ToolApprovalPolicyContext): ProjectApprovalRule | undefined {
    const repository = this.createProjectApprovalRuleRepository();
    const rule = ProjectApprovalRules.createForCall(context.call);
    if (!repository || !rule) {
      return undefined;
    }

    const rules = repository.list();
    const existing = ProjectApprovalRules.findMatching({
      rules,
      tool: rule.tool,
      input: rule.command,
    });
    if (existing) {
      return existing;
    }

    repository.save([...rules, rule]);
    return rule;
  }

  isApprovedByRememberedProjectRule(context: ToolApprovalPolicyContext): boolean {
    const rules = this.createProjectApprovalRuleRepository()?.list() ?? [];
    return Boolean(ProjectApprovalRules.findMatching({
      rules,
      tool: context.call.tool,
      input: context.call.input,
    }));
  }

  private createProjectApprovalRuleRepository(): FileProjectApprovalRuleRepository | undefined {
    return this.options.projectApprovalRulesFile
      ? new FileProjectApprovalRuleRepository(this.options.projectApprovalRulesFile)
      : undefined;
  }
}
