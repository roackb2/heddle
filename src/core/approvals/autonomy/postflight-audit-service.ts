import { isAbsolute, relative, resolve } from 'node:path';
import compact from 'lodash/compact.js';
import uniq from 'lodash/uniq.js';
import type { ToolResult } from '@/core/types.js';
import type { AutonomyEvaluation, AutonomyPostflightAudit } from './types.js';

/**
 * Builds post-execution audit records for unattended autopilot tool calls.
 *
 * This service owns the autonomy-domain interpretation of observed tool output.
 * It does not execute tools and it does not make host/UI decisions.
 */
export class AutonomyPostflightAuditService {
  static shouldAudit(evaluation: AutonomyEvaluation | undefined): evaluation is AutonomyEvaluation {
    return evaluation?.profileMode === 'autopilot' && evaluation.decision.type === 'allow';
  }

  static create(args: {
    evaluation: AutonomyEvaluation;
    result: ToolResult;
    workspaceRoot?: string;
  }): AutonomyPostflightAudit {
    const workspaceRoot = resolve(args.workspaceRoot ?? args.evaluation.facts.cwd ?? process.cwd());
    const changedPaths = AutonomyPostflightAuditService.extractChangedPaths({
      output: args.result.output,
      workspaceRoot,
    });
    const changedRoots = AutonomyPostflightAuditService.resolveChangedRoots({
      changedPaths,
      declaredWriteRoots: args.evaluation.facts.claimedWriteRoots,
    });
    const exceededDeclaredRoots = AutonomyPostflightAuditService.resolveExceededDeclaredRoots({
      changedPaths,
      declaredWriteRoots: args.evaluation.facts.claimedWriteRoots,
    });
    const gitHistoryChanged = AutonomyPostflightAuditService.detectGitHistoryChange(args.evaluation.facts.command);
    const decision = exceededDeclaredRoots.length > 0 || gitHistoryChanged ? 'stop' : 'continue';

    return {
      call: args.evaluation.call,
      envelope: args.evaluation.envelope,
      observedEffects: {
        changedPaths,
        changedRoots,
        exceededDeclaredRoots,
        gitHistoryChanged,
      },
      decision,
      reason: AutonomyPostflightAuditService.formatReason({
        changedPaths,
        exceededDeclaredRoots,
        gitHistoryChanged,
        decision,
      }),
    };
  }

  private static extractChangedPaths(args: {
    output: unknown;
    workspaceRoot: string;
  }): string[] {
    if (!isRecord(args.output)) {
      return [];
    }

    const changedPaths = [
      ...AutonomyPostflightAuditService.stringArray(args.output.changedPaths),
      AutonomyPostflightAuditService.stringValue(args.output.path),
      AutonomyPostflightAuditService.stringValue(args.output.from),
      AutonomyPostflightAuditService.stringValue(args.output.to),
    ];

    return uniq(compact(changedPaths).map((path) => resolve(args.workspaceRoot, path)));
  }

  private static resolveChangedRoots(args: {
    changedPaths: string[];
    declaredWriteRoots: string[];
  }): string[] {
    return uniq(args.changedPaths.map((changedPath) =>
      AutonomyPostflightAuditService.findContainingRoot({
        path: changedPath,
        roots: args.declaredWriteRoots,
      }) ?? changedPath,
    ));
  }

  private static resolveExceededDeclaredRoots(args: {
    changedPaths: string[];
    declaredWriteRoots: string[];
  }): string[] {
    if (args.changedPaths.length === 0) {
      return [];
    }

    return args.changedPaths.filter((changedPath) =>
      !AutonomyPostflightAuditService.findContainingRoot({
        path: changedPath,
        roots: args.declaredWriteRoots,
      }),
    );
  }

  private static findContainingRoot(args: {
    path: string;
    roots: string[];
  }): string | undefined {
    return args.roots.find((root) => AutonomyPostflightAuditService.isInsideRoot(root, args.path));
  }

  private static isInsideRoot(root: string, target: string): boolean {
    const relativeTarget = relative(root, target);
    return relativeTarget === '' || (!relativeTarget.startsWith('..') && !isAbsolute(relativeTarget));
  }

  private static detectGitHistoryChange(command: string | undefined): boolean {
    if (!command) {
      return false;
    }

    const normalized = command.trim().toLowerCase().replace(/\s+/g, ' ');
    return [
      /(?:^|[;&|])\s*git\s+commit\b/,
      /(?:^|[;&|])\s*git\s+reset\b/,
      /(?:^|[;&|])\s*git\s+rebase\b/,
      /(?:^|[;&|])\s*git\s+push\b.*\s--force(?:\s|$)/,
    ].some((pattern) => pattern.test(normalized));
  }

  private static formatReason(args: {
    changedPaths: string[];
    exceededDeclaredRoots: string[];
    gitHistoryChanged: boolean;
    decision: AutonomyPostflightAudit['decision'];
  }): string {
    if (args.exceededDeclaredRoots.length > 0) {
      return `observed changes exceeded declared write roots: ${args.exceededDeclaredRoots.join(', ')}`;
    }

    if (args.gitHistoryChanged) {
      return 'observed git history mutation from command text';
    }

    if (args.changedPaths.length === 0) {
      return 'tool result did not report structured changed paths';
    }

    return args.decision === 'continue'
      ? 'observed changes stayed within declared write roots'
      : 'postflight audit requested stop';
  }

  private static stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private static stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
