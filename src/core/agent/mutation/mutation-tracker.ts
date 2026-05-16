import { extractShellCommand } from '@/core/agent/utils/index.js';
import type { TrackAgentMutationResultArgs, MutationState } from './types.js';

/**
 * Tracks workspace-changing actions observed during a low-level agent run.
 *
 * The state is intentionally lightweight today; future review or verification
 * requirements should extend this class instead of scattering mutation policy
 * across the run loop.
 */
export class AgentMutationTracker {
  static createState(): MutationState {
    return {
      executedMutationCommands: [],
    };
  }

  static trackToolResult(args: TrackAgentMutationResultArgs): void {
    if (!args.result.ok) {
      return;
    }

    const command = extractShellCommand(args.effectiveCall.input);

    if (args.effectiveCall.tool === 'run_shell_mutate' && command && AgentMutationTracker.isWorkspaceChangeMutateCommand(command)) {
      args.state.executedMutationCommands.push(command);
    }

    if (args.effectiveCall.tool === 'edit_file') {
      args.state.executedMutationCommands.push(AgentMutationTracker.describeEditMutation(args.effectiveCall.input));
    }
  }

  static isWorkspaceChangeMutateCommand(command: string): boolean {
    return (
      /^yarn format\b/.test(command) ||
      /^yarn prettier\b/.test(command) ||
      /^yarn eslint\b/.test(command) ||
      /^yarn add\b/.test(command) ||
      /^yarn install\b/.test(command) ||
      /^yarn remove\b/.test(command) ||
      /^mkdir\b/.test(command) ||
      /^touch\b/.test(command) ||
      /^mv\b/.test(command) ||
      /^cp\b/.test(command) ||
      /^git add\b/.test(command) ||
      /^git mv\b/.test(command) ||
      /^npx prettier --write\b/.test(command) ||
      /^npx eslint --fix\b/.test(command) ||
      /^prettier --write\b/.test(command) ||
      /^eslint --fix\b/.test(command)
    );
  }

  static isVerificationMutateCommand(command: string): boolean {
    return (
      /^yarn test\b/.test(command) ||
      /^yarn build\b/.test(command) ||
      /^yarn lint\b/.test(command) ||
      /^yarn vitest\b/.test(command) ||
      /^vitest\b/.test(command) ||
      /^tsc\b/.test(command)
    );
  }

  static isRepoReviewCommand(command: string): boolean {
    const normalized = AgentMutationTracker.normalizeCommand(command);
    return (
      normalized.startsWith('git status') && AgentMutationTracker.includesFlag(normalized, '--short')
    ) || (
      normalized.startsWith('git diff') && AgentMutationTracker.includesFlag(normalized, '--stat')
    );
  }

  private static normalizeCommand(command: string): string {
    return command.trim().replace(/\s+/g, ' ');
  }

  private static includesFlag(command: string, flag: string): boolean {
    const pattern = new RegExp(`(?:^|\\s)${AgentMutationTracker.escapeRegExp(flag)}(?:=\\S+|\\s|$)`);
    return pattern.test(command);
  }

  private static escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private static describeEditMutation(input: unknown): string {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return 'edit_file';
    }

    const path = (input as { path?: unknown }).path;
    return typeof path === 'string' && path.trim() ? `edit_file ${path.trim()}` : 'edit_file';
  }
}
