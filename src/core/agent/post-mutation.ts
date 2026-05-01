// ---------------------------------------------------------------------------
// Post-mutation host requirements — placeholder scaffold for future follow-up
// behavior. It currently returns no runtime requirement so mutation tracking
// can evolve without steering the agent mid-run.
// ---------------------------------------------------------------------------

export function buildPostMutationRequirement(_options: {
  pendingVerification: boolean;
  pendingChangeReview: boolean;
  reviewCommands?: string[];
  verificationCommands?: string[];
  noteExistingVerification?: boolean;
}): string | undefined {
  return undefined;
}
