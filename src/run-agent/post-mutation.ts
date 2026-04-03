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
  const summaryLead = extractSummaryLead(content);
  if (!summaryLead) {
    return false;
  }

  const changedLine = extractStructuredSummaryLine(content, 'Changed');
  const verifiedLine = extractStructuredSummaryLine(content, 'Verified');
  const uncertaintyLine =
    extractStructuredSummaryLine(content, 'Remaining uncertainty') ??
    extractStructuredSummaryLine(content, 'Uncertainty') ??
    extractStructuredSummaryLine(content, 'Remaining risks');

  if (!changedLine || !verifiedLine || !uncertaintyLine) {
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

  return `Host requirement: after a workspace-changing mutate command, your final answer must start with a short summary sentence or short paragraph, then include bullet points labeled "Changed:", "Verified:", and "Remaining uncertainty:". In "Changed:", mention the concrete change work and name the exact command(s) or edit action used (${mutationSummary}). In "Verified:", name the exact repo review command(s) (${reviewSummary}) and exact verification command(s) (${verificationSummary}), and ground them in concrete evidence from the command results (${reviewEvidenceSummary}; ${verificationEvidenceSummary}). If nothing remains uncertain, explicitly write "Remaining uncertainty: none".`;
}

function extractStructuredSummaryLine(
  content: string,
  label: 'Changed' | 'Verified' | 'Remaining uncertainty' | 'Uncertainty' | 'Remaining risks',
): string | undefined {
  const match = content.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s+)?${escapeRegExp(label)}\\s*:\\s*([^\\n]+)`, 'i'));
  return match?.[1]?.trim();
}

function extractSummaryLead(content: string): string | undefined {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const first = lines[0];
  if (!first) {
    return undefined;
  }

  if (/^(?:[-*]\s+)?(?:changed|verified|remaining uncertainty|uncertainty|remaining risks?)\s*:/i.test(first)) {
    return undefined;
  }

  return first;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
