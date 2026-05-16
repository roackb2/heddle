import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolCall } from '@/core/types.js';
import type { ToolApprovalPolicy, ToolApprovalPolicyContext, ToolApprovalSurface } from './types.js';

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
}
