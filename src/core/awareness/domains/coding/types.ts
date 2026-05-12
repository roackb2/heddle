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

export type CodingWorkspaceTreeEntry = {
  path: string;
  kind: 'file' | 'directory';
  children?: CodingWorkspaceTreeEntry[];
  truncated?: boolean;
};

export type CodingWorkspaceTree = {
  root: string;
  maxDepth: number;
  maxEntries: number;
  entries: CodingWorkspaceTreeEntry[];
};

export type CodingWorkingEnvironmentSection = {
  type: 'working_environment';
  data: CodingWorkingEnvironment;
};

export type CodingWorkspaceTreeSection = {
  type: 'workspace_tree';
  data: CodingWorkspaceTree;
};

export type CodingAwarenessSection =
  | CodingWorkingEnvironmentSection
  | CodingWorkspaceTreeSection;

export type CodingProjectDashboardOutput = {
  schemaVersion: 1;
  domain: 'coding';
  profile: 'project_dashboard';
  collectedAt: string;
  workspaceRoot: string;
  sections: Partial<{
    working_environment: CodingWorkingEnvironment;
    workspace_tree: CodingWorkspaceTree;
  }>;
  sources: AwarenessSnapshot['sources'];
  limits: AwarenessSnapshot['limits'];
};

export type CodingAwarenessSnapshot = AwarenessSnapshot<CodingAwarenessSection>;
