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

export type CodingProjectKind = 'javascript' | 'python' | 'go';

export type CodingManifestSignal = {
  kind: string;
  path: string;
};

export type CodingLockfileSignal = {
  kind: string;
  path: string;
};

export type CodingVerificationSurface = {
  kind: 'script_names' | 'command';
  label: string;
  sourcePath?: string;
  scriptNames?: string[];
  commands?: string[];
};

export type CodingDetectedProject = {
  kind: CodingProjectKind;
  manifests: CodingManifestSignal[];
  lockfiles: CodingLockfileSignal[];
  verificationSurfaces: CodingVerificationSurface[];
};

export type CodingProjectSignals = {
  detectedProjects: CodingDetectedProject[];
  observedDirectories: {
    source: string[];
    tests: string[];
    docs: string[];
    examples: string[];
    scripts: string[];
    config: string[];
  };
  configFiles: string[];
};

export type CodingInspectionSurface =
  | { kind: 'manifest'; paths: string[] }
  | {
      kind: 'directory';
      role: keyof CodingProjectSignals['observedDirectories'];
      paths: string[];
    }
  | { kind: 'config_file'; paths: string[] }
  | { kind: 'verification_surface'; labels: string[] }
  | {
      kind: 'dirty_paths';
      counts: {
        staged: number;
        modified: number;
        deleted: number;
        untracked: number;
        renamed: number;
      };
    };

export type CodingWorkingEnvironmentSection = {
  type: 'working_environment';
  data: CodingWorkingEnvironment;
};

export type CodingWorkspaceTreeSection = {
  type: 'workspace_tree';
  data: CodingWorkspaceTree;
};

export type CodingProjectSignalsSection = {
  type: 'project_signals';
  data: CodingProjectSignals;
};

export type CodingInspectionSurfacesSection = {
  type: 'inspection_surfaces';
  data: CodingInspectionSurface[];
};

export type CodingAwarenessSection =
  | CodingWorkingEnvironmentSection
  | CodingWorkspaceTreeSection
  | CodingProjectSignalsSection
  | CodingInspectionSurfacesSection;

export type CodingProjectDashboardOutput = {
  schemaVersion: 1;
  domain: 'coding';
  profile: 'project_dashboard';
  collectedAt: string;
  workspaceRoot: string;
  sections: Partial<{
    working_environment: CodingWorkingEnvironment;
    workspace_tree: CodingWorkspaceTree;
    project_signals: CodingProjectSignals;
    inspection_surfaces: CodingInspectionSurface[];
  }>;
  sources: AwarenessSnapshot['sources'];
  limits: AwarenessSnapshot['limits'];
};

export type CodingAwarenessSnapshot = AwarenessSnapshot<CodingAwarenessSection>;
