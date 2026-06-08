import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolCall } from '@/core/types.js';
import {
  classifyShellCommandPolicy,
  DEFAULT_MUTATE_RULES,
} from '@/core/tools/toolkits/shell-process/shell-policy.js';
import type { ToolApprovalPolicy, ToolApprovalPolicyContext, ToolApprovalSurface } from './types.js';
import { AutonomyPolicyService, type AutopilotProfile } from './autonomy/index.js';

/**
 * Owns reusable approval policy constructors and the default policy chain.
 */
export class ToolApprovalPolicies {
  static default(): ToolApprovalPolicy[] {
    return [
      ToolApprovalPolicies.toolRequiresApproval(),
      ToolApprovalPolicies.outsideWorkspaceInspection(),
    ];
  }

  static toolRequiresApproval(): ToolApprovalPolicy {
    return ({ tool }) =>
      tool.requiresApproval ? { type: 'request', reason: `${tool.name} requires approval` } : undefined;
  }

  static outsideWorkspaceInspection(): ToolApprovalPolicy {
    return ({ call, workspaceRoot }) =>
      ToolApprovalPolicies.isOutsideWorkspaceInspectionCall({ call, workspaceRoot }) ?
        { type: 'request', reason: `${call.tool} targets a path outside the workspace` }
      : undefined;
  }

  static rememberedProjectRule(args: {
    isApproved: (context: ToolApprovalPolicyContext) => boolean;
    reason?: string;
  }): ToolApprovalPolicy {
    return (context) =>
      args.isApproved(context) ?
        { type: 'allow', reason: args.reason ?? 'Approved by saved project rule' }
      : undefined;
  }

  static humanSurface(surface: ToolApprovalSurface): ToolApprovalPolicy {
    return async (context) => {
      const decision = await surface(context);
      return decision.approved ?
          { type: 'allow', reason: decision.reason }
        : { type: 'deny', reason: decision.reason };
    };
  }

  static unattendedLocalAutomation(): ToolApprovalPolicy {
    return ({ call }) => {
      if (['read_file', 'list_files', 'search_files', 'edit_file'].includes(call.tool)) {
        return { type: 'allow', reason: 'Allowed for unattended local automation' };
      }

      const command = ToolApprovalPolicies.getShellCommand(call);
      if (!command) {
        return undefined;
      }

      const policy = classifyShellCommandPolicy(command, {
        toolName: 'run_shell_mutate',
        rules: DEFAULT_MUTATE_RULES,
        allowUnknown: true,
      });

      return 'error' in policy
        ? { type: 'deny', reason: policy.error }
        : { type: 'allow', reason: policy.reason };
    };
  }

  static autopilot(args: { profile: AutopilotProfile }): ToolApprovalPolicy {
    return (context) =>
      AutonomyPolicyService.toApprovalDecision(
        AutonomyPolicyService.evaluate({
          context,
          profile: args.profile,
        }),
      );
  }

  static isOutsideWorkspaceInspectionCall(args: {
    call: ToolCall;
    workspaceRoot?: string;
  }): boolean {
    const { call, workspaceRoot = process.cwd() } = args;
    if (!['read_file', 'list_files', 'search_files', 'edit_file'].includes(call.tool)) {
      return false;
    }

    const input = call.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return false;
    }

    const record = input as Record<string, unknown>;
    const rawPath = typeof record.path === 'string'
      ? record.path
      : call.tool === 'search_files' ? '.'
      : undefined;
    if (!rawPath) {
      return false;
    }

    const resolvedWorkspaceRoot = resolve(workspaceRoot);
    const resolvedTarget = resolve(resolvedWorkspaceRoot, rawPath);
    const relativeTarget = relative(resolvedWorkspaceRoot, resolvedTarget);
    return relativeTarget.startsWith('..') || isAbsolute(relativeTarget);
  }

  private static getShellCommand(call: ToolCall): string | undefined {
    if (call.tool !== 'run_shell_mutate') {
      return undefined;
    }

    const input = call.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return undefined;
    }

    const command = (input as Record<string, unknown>).command;
    return typeof command === 'string' && command.trim() ? command : undefined;
  }
}
