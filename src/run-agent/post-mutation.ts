// ---------------------------------------------------------------------------
// Post-mutation host requirements — blocks premature final answers until
// the agent has reviewed and verified workspace-changing mutations.
// ---------------------------------------------------------------------------

import type { MutationState } from './mutation-tracking.js';

export function buildPostMutationRequirement(options: {
  pendingVerification: boolean;
  pendingChangeReview: boolean;
}): string {
  const requirements: string[] = [];

  if (options.pendingChangeReview) {
    requirements.push(
      'inspect the resulting repo state with concrete git review evidence such as git status --short or git diff --stat',
    );
  }

  if (options.pendingVerification) {
    requirements.push('run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc');
  }

  return `Host requirement: before giving a final answer after a workspace-changing mutate command, you must ${requirements.join(' and ')}. After doing that, then provide the final answer.`;
}

export function hasStructuredChangeSummary(
  content: string,
  options: {
    mutationCommands: string[];
    reviewCommands: string[];
    verificationCommands: string[];
  },
): boolean {
  const normalized = content.toLowerCase();

  if (
    !/(?:^|\n)changed\s*:/.test(normalized) ||
    !/(?:^|\n)verified\s*:/.test(normalized) ||
    !/(?:^|\n)(?:remaining uncertainty|uncertainty|remaining risks?)\s*:/.test(normalized)
  ) {
    return false;
  }

  const changedLine = extractStructuredSummaryLine(content, 'Changed');
  const verifiedLine = extractStructuredSummaryLine(content, 'Verified');
  if (!changedLine || !verifiedLine) {
    return false;
  }

  const normalizedChangedLine = changedLine.toLowerCase();
  const normalizedVerifiedLine = verifiedLine.toLowerCase();

  const mentionsMutation =
    options.mutationCommands.length === 0 ||
    options.mutationCommands.some((command) => normalizedChangedLine.includes(command.toLowerCase()));
  const mentionsReview =
    options.reviewCommands.length === 0 ||
    options.reviewCommands.some((command) => normalizedVerifiedLine.includes(command.toLowerCase()));
  const mentionsVerification =
    options.verificationCommands.length === 0 ||
    options.verificationCommands.some((command) => normalizedVerifiedLine.includes(command.toLowerCase()));

  return mentionsMutation && mentionsReview && mentionsVerification;
}

export function buildStructuredChangeSummaryRequirement(state: MutationState): string {
  const mutationSummary = state.executedMutationCommands.length > 0
    ? state.executedMutationCommands.join('; ')
    : 'workspace-changing command(s) already executed';
  const reviewSummary = state.executedReviewCommands.length > 0
    ? state.executedReviewCommands.join('; ')
    : 'no repo review command recorded';
  const verificationSummary = state.executedVerificationCommands.length > 0
    ? state.executedVerificationCommands.join('; ')
    : 'no verification command recorded';
  const reviewEvidenceSummary = state.executedReviewEvidence.length > 0
    ? state.executedReviewEvidence.join('; ')
    : 'no repo review evidence captured';
  const verificationEvidenceSummary = state.executedVerificationEvidence.length > 0
    ? state.executedVerificationEvidence.join('; ')
    : 'no verification evidence captured';

  return `Host requirement: after a workspace-changing mutate command, your final answer must be a short operator review with exactly these labels on separate lines: "Changed:", "Verified:", and "Remaining uncertainty:". In "Changed:", mention the concrete change work and name the exact command(s) or edit action used (${mutationSummary}). In "Verified:", name the exact repo review command(s) (${reviewSummary}) and exact verification command(s) (${verificationSummary}), and ground them in concrete evidence from the command results (${reviewEvidenceSummary}; ${verificationEvidenceSummary}). If nothing remains uncertain, explicitly write "Remaining uncertainty: none".`;
}

function extractStructuredSummaryLine(content: string, label: 'Changed' | 'Verified'): string | undefined {
  const match = content.match(new RegExp(`(?:^|\\n)${label}\\s*:\\s*([^\\n]+)`, 'i'));
  return match?.[1]?.trim();
}
