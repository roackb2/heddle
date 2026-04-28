// ---------------------------------------------------------------------------
// Post-mutation host requirements — blocks premature final answers until
// the agent has reviewed and verified workspace-changing mutations.
// ---------------------------------------------------------------------------

import type { MutationState } from './mutation-tracking.js';

export function buildPostMutationRequirement(options: {
  pendingVerification: boolean;
  pendingChangeReview: boolean;
  reviewCommands?: string[];
  verificationCommands?: string[];
  noteExistingVerification?: boolean;
}): string {
  const requirements: string[] = [];

  if (options.pendingChangeReview) {
    const reviewGuidance = options.reviewCommands && options.reviewCommands.length > 0
      ? `inspect the resulting repo state with concrete git review evidence. Review already captured: ${options.reviewCommands.join('; ')}. Also run the missing git-native review command such as git status --short or git diff --stat`
      : 'inspect the resulting repo state with concrete git review evidence such as git status --short or git diff --stat';
    requirements.push(reviewGuidance);
  }

  if (options.pendingVerification) {
    const verificationGuidance = options.verificationCommands && options.verificationCommands.length > 0
      ? `run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc. Verification already captured: ${options.verificationCommands.join('; ')}. Re-run or add another verification command only if needed`
      : 'run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc';
    requirements.push(verificationGuidance);
  } else if (options.noteExistingVerification && options.verificationCommands && options.verificationCommands.length > 0) {
    requirements.push(`note: verification already captured: ${options.verificationCommands.join('; ')}. Additional verification is not required unless the repo state changed again.`);
  }

  return `Host requirement: before giving a final answer after a workspace-changing action, you must ${requirements.join(' and ')}. After doing that, then provide the final answer.`;
}

