import { existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type {
  AutonomyEvaluation,
  AutopilotRootApproval,
} from './types.js';
import { AutonomyPermissionModeService } from './permission-mode-service.js';
import { AutopilotProfileService } from './profile-service.js';

const PROJECT_ROOT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'deno.json',
  'pnpm-workspace.yaml',
  'yarn.lock',
];

/**
 * Resolves human approval targets into repo/project roots for Auto expansion.
 *
 * This service detects candidate roots only. It does not decide whether a tool
 * is safe; the detected root is added to the Auto profile and evaluated by
 * AutonomyPolicyService like every other root.
 */
export class AutonomyRootScopeService {
  static resolveAutoRootApproval(args: {
    evaluation?: AutonomyEvaluation;
    workspaceRoot: string;
  }): AutopilotRootApproval | undefined {
    const evaluation = args.evaluation;
    if (!evaluation || evaluation.profilePreset !== 'auto' || evaluation.decision.type !== 'request') {
      return undefined;
    }

    if (evaluation.facts.hardDenyReasons.length > 0) {
      return undefined;
    }

    const target = evaluation.facts.rootDecisions.find((decision) => (
      decision.access === 'manual-only' || decision.access === 'unconfigured'
    ))?.root;
    if (!target) {
      return undefined;
    }

    const root = AutonomyRootScopeService.findProjectRoot({
      target,
      workspaceRoot: args.workspaceRoot,
    });
    if (!root || AutopilotProfileService.isInsideRoot(root, args.workspaceRoot)) {
      return undefined;
    }

    const relativeRoot = AutonomyRootScopeService.formatRootForDisplay({
      workspaceRoot: args.workspaceRoot,
      root,
    });
    return {
      label: 'Trust this repo',
      root,
      relativeRoot,
      access: 'autopilot',
      allow: AutonomyPermissionModeService.autoRootCapabilities(),
    };
  }

  static findProjectRoot(args: {
    target: string;
    workspaceRoot: string;
  }): string | undefined {
    const start = AutonomyRootScopeService.resolveSearchStart(args.target);
    const searchCeiling = dirname(resolve(args.workspaceRoot));
    if (!AutopilotProfileService.isInsideRoot(start, searchCeiling)) {
      return undefined;
    }

    let current = start;
    let nearestProjectRoot: string | undefined;

    while (AutopilotProfileService.isInsideRoot(current, searchCeiling) && current !== searchCeiling) {
      if (existsSync(resolve(current, '.git'))) {
        return current;
      }

      if (!nearestProjectRoot && PROJECT_ROOT_MARKERS.some((marker) => existsSync(resolve(current, marker)))) {
        nearestProjectRoot = current;
      }

      current = dirname(current);
    }

    return nearestProjectRoot;
  }

  private static resolveSearchStart(target: string): string {
    const resolved = resolve(target);
    if (!existsSync(resolved)) {
      return dirname(resolved);
    }

    return statSync(resolved).isDirectory() ? resolved : dirname(resolved);
  }

  private static formatRootForDisplay(args: {
    workspaceRoot: string;
    root: string;
  }): string {
    const relativeRoot = relative(resolve(args.workspaceRoot), args.root);
    return relativeRoot === '' ? '.' : relativeRoot;
  }
}
