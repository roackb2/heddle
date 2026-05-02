import { isAbsolute, relative, resolve } from 'node:path';
import type {
  ToolApprovalPolicy,
  ToolApprovalPolicyContext,
} from './types.js';

export const toolRequiresApprovalPolicy: ToolApprovalPolicy = ({ tool }) =>
  tool.requiresApproval ? { type: 'request', reason: `${tool.name} requires approval` } : undefined;

export const outsideWorkspaceInspectionPolicy: ToolApprovalPolicy = ({ call, workspaceRoot }) =>
  isOutsideWorkspaceInspectionCall(call, workspaceRoot) ?
    { type: 'request', reason: `${call.tool} targets a path outside the workspace` }
  : undefined;

export function rememberedApprovalPolicy(args: {
  isApproved: (context: ToolApprovalPolicyContext) => boolean;
  reason?: string;
}): ToolApprovalPolicy {
  return (context) =>
    args.isApproved(context) ?
      { type: 'allow', reason: args.reason ?? 'Approved by saved project rule' }
    : undefined;
}

export const defaultToolApprovalPolicies: ToolApprovalPolicy[] = [
  toolRequiresApprovalPolicy,
  outsideWorkspaceInspectionPolicy,
];

export function isOutsideWorkspaceInspectionCall(
  contextOrCall: ToolApprovalPolicyContext | ToolApprovalPolicyContext['call'],
  workspaceRoot = process.cwd(),
): boolean {
  const call = 'call' in contextOrCall ? contextOrCall.call : contextOrCall;
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
