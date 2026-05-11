import type { AwarenessSnapshot } from '../../types.js';

export type CodingWorkingTreePathGroup = {
  staged: string[];
  modified: string[];
  deleted: string[];
  untracked: string[];
  renamed: Array<{ from: string; to: string }>;
};

export type CodingWorkingEnvironment = {
  workspaceRoot: string;
  gitRepositoryRoot?: string;
  gitBranch?: string;
  gitShortCommit?: string;
  isGitRepository: boolean;
  isDirty: boolean;
  paths: CodingWorkingTreePathGroup;
};

export type CodingAwarenessSection = {
  type: 'working_environment';
  data: CodingWorkingEnvironment;
};

export type CodingAwarenessSnapshot = AwarenessSnapshot<CodingAwarenessSection>;
