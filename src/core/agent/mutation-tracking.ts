// ---------------------------------------------------------------------------
// Mutation tracking — lightweight classification for workspace-changing
// commands and edits. The richer review/verification follow-up state is
// intentionally dormant for now.
// ---------------------------------------------------------------------------

import type { ToolCall } from '../types.js';
import { extractShellCommand } from './util.js';

export type MutationState = {
  executedMutationCommands: string[];
};

export function createMutationState(): MutationState {
  return {
    executedMutationCommands: [],
  };
}

export function trackToolResult(
  state: MutationState,
  effectiveCall: ToolCall,
  result: { ok: boolean; output?: unknown },
): void {
  if (!result.ok) {
    return;
  }

  const command = extractShellCommand(effectiveCall.input);

  if (effectiveCall.tool === 'run_shell_mutate' && command && isWorkspaceChangeMutateCommand(command)) {
    state.executedMutationCommands.push(command);
  }

  if (effectiveCall.tool === 'edit_file') {
    state.executedMutationCommands.push(describeEditMutation(effectiveCall.input));
  }
}

export function isWorkspaceChangeMutateCommand(command: string): boolean {
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

export function isVerificationMutateCommand(command: string): boolean {
  return (
    /^yarn test\b/.test(command) ||
    /^yarn build\b/.test(command) ||
    /^yarn lint\b/.test(command) ||
    /^yarn vitest\b/.test(command) ||
    /^vitest\b/.test(command) ||
    /^tsc\b/.test(command)
  );
}

export function isRepoReviewCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  return (
    normalized.startsWith('git status') && includesFlag(normalized, '--short')
  ) || (
    normalized.startsWith('git diff') && includesFlag(normalized, '--stat')
  );
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function includesFlag(command: string, flag: string): boolean {
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(flag)}(?:=\\S+|\\s|$)`);
  return pattern.test(command);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describeEditMutation(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'edit_file';
  }

  const path = (input as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? `edit_file ${path.trim()}` : 'edit_file';
}
