import type {
  EvaluateToolApprovalPoliciesArgs,
  RequestToolApprovalThroughServiceArgs,
  ResolveToolApprovalArgs,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolApprovalPolicyDecision,
  ToolApprovalUserDecision,
} from './types.js';
import {
  FileProjectApprovalRuleRepository,
  ProjectApprovalRules,
  type ProjectApprovalRule,
} from './remembered-rules/index.js';
import { previewEditFileInput } from '@/core/tools/toolkits/coding-files/edit-file.js';
import { ToolActivitySummarizer } from '@/core/live/index.js';
import { ToolPolicyEnvelopeInputService } from '@/core/tools/index.js';
import type { ToolApprovalPolicyContext } from './types.js';
import { AutonomyRootScopeService } from './autonomy/index.js';

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
    let autonomyEvaluation: ToolApprovalDecision['autonomyEvaluation'];

    for (const policy of args.policies) {
      const decision = await policy(args.context);
      if (!decision) {
        continue;
      }

      autonomyEvaluation ??= decision.autonomyEvaluation;

      if (decision.type === 'deny') {
        return ToolApprovalService.withAutonomyEvaluation({ approved: false, reason: decision.reason }, autonomyEvaluation);
      }

      if (decision.type === 'allow') {
        return ToolApprovalService.withAutonomyEvaluation({ approved: true, reason: decision.reason }, autonomyEvaluation);
      }

      requestReason ??= decision.reason;
    }

    if (!requestReason) {
      return { approved: true };
    }

    if (!args.requestHumanApproval) {
      return {
        ...ToolApprovalService.withAutonomyEvaluation({
          approved: false,
          reason: `No approval handler configured for ${args.context.call.tool}${requestReason ? `: ${requestReason}` : ''}`,
        }, autonomyEvaluation),
      };
    }

    const decision = await args.requestHumanApproval(args.context, requestReason, autonomyEvaluation);
    return ToolApprovalService.withAutonomyEvaluation(decision, autonomyEvaluation);
  }

  async requestHumanApproval(args: RequestToolApprovalThroughServiceArgs): Promise<ToolApprovalDecision> {
    const request = await this.createRequest(args);
    // Pending approval is an in-memory promise handoff. The service creates the
    // request payload, then waits until the host/controller resolves it with a
    // user decision.
    const decision = await new Promise<ToolApprovalUserDecision>((resolve) => {
      args.storePending?.({ request, resolve });
    });
    return this.resolveUserDecision({
      context: args,
      decision,
    });
  }

  async createRequest(args: ToolApprovalPolicyContext & {
    reason?: string;
    autonomyEvaluation?: ToolApprovalDecision['autonomyEvaluation'];
  }): Promise<ToolApprovalRequest> {
    const input = ToolPolicyEnvelopeInputService.extract(args.call.input).toolInput;
    const call = {
      ...args.call,
      input,
    };
    const rememberedRule = ProjectApprovalRules.createForCall(call);
    const editPreview =
      args.call.tool === 'edit_file'
        ? await previewEditFileInput(input, this.options.workspaceRoot)
        : undefined;

    return {
      tool: args.tool.name,
      callId: args.call.id,
      input,
      requestedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      summary: ToolActivitySummarizer.summarizeCall(call),
      reason: args.reason,
      editPreview,
      autopilotRootApproval: AutonomyRootScopeService.resolveAutoRootApproval({
        evaluation: args.autonomyEvaluation,
        workspaceRoot: args.workspaceRoot ?? this.options.workspaceRoot ?? process.cwd(),
      }),
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

    if (args.decision.type === 'approve_and_trust_autopilot_root') {
      return {
        approved: true,
        reason: args.decision.reason ?? 'Approved and trusted this repo for Auto',
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

  private static withAutonomyEvaluation(
    decision: ToolApprovalDecision,
    autonomyEvaluation: ToolApprovalDecision['autonomyEvaluation'],
  ): ToolApprovalDecision {
    return autonomyEvaluation ? { ...decision, autonomyEvaluation } : decision;
  }
}
