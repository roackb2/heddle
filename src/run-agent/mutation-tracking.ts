// ---------------------------------------------------------------------------
// Mutation tracking — classifies shell commands and tool calls by their
// workspace effect (change, verify, review) so the main loop can enforce
// post-mutation requirements.
// ---------------------------------------------------------------------------

import type { ToolCall } from '../types.js';
import { extractShellCommand } from './util.js';

export type MutationState = {
  pendingVerification: boolean;
  pendingChangeReview: boolean;
  requiresStructuredChangeSummary: boolean;
  executedMutationCommands: string[];
  executedReviewCommands: string[];
  executedVerificationCommands: string[];
  executedReviewEvidence: string[];
  executedVerificationEvidence: string[];
};

export function createMutationState(): MutationState {
  return {
    pendingVerification: false,
    pendingChangeReview: false,
    requiresStructuredChangeSummary: false,
    executedMutationCommands: [],
    executedReviewCommands: [],
    executedVerificationCommands: [],
    executedReviewEvidence: [],
    executedVerificationEvidence: [],
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

  if (effectiveCall.tool === 'run_shell_mutate' && command) {
    if (isWorkspaceChangeMutateCommand(command)) {
      state.pendingVerification = true;
      state.pendingChangeReview = true;
      state.requiresStructuredChangeSummary = true;
      state.executedMutationCommands.push(command);
    }

    if (isVerificationMutateCommand(command)) {
      state.pendingVerification = false;
      state.executedVerificationCommands.push(command);
    }
  }

  if (effectiveCall.tool === 'edit_file') {
    state.pendingVerification = true;
    state.pendingChangeReview = true;
    state.requiresStructuredChangeSummary = true;
    state.executedMutationCommands.push(describeEditMutation(effectiveCall.input));
  }

  if (effectiveCall.tool === 'run_shell_inspect' && command && isRepoReviewCommand(command)) {
    state.pendingChangeReview = false;
    state.executedReviewCommands.push(command);
    state.executedReviewEvidence.push(summarizeCommandEvidence(result.output));
  }

  if (effectiveCall.tool === 'run_shell_mutate' && command && isVerificationMutateCommand(command)) {
    state.executedVerificationEvidence.push(summarizeCommandEvidence(result.output));
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

function isRepoReviewCommand(command: string): boolean {
  return /^git status\b/.test(command) || /^git diff\b/.test(command);
}

function describeEditMutation(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'edit_file';
  }

  const path = (input as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? `edit_file ${path.trim()}` : 'edit_file';
}

function summarizeCommandEvidence(output: unknown): string {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return 'no structured command output recorded';
  }

  const candidate = output as {
    command?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
  };
  const command = typeof candidate.command === 'string' && candidate.command.trim() ? candidate.command.trim() : 'command';
  const stdout = typeof candidate.stdout === 'string' ? candidate.stdout.trim() : '';
  const stderr = typeof candidate.stderr === 'string' ? candidate.stderr.trim() : '';
  const exitCode = typeof candidate.exitCode === 'number' ? candidate.exitCode : 0;
  const body = stdout || stderr;
  const snippet = body ? body.replace(/\s+/g, ' ').slice(0, 120) : 'no stdout/stderr output';
  return `${command} => exit ${exitCode}, ${snippet}`;
}
