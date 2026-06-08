import type { AutopilotProfile } from '@/core/approvals/index.js';

export type ProjectConfig = {
  model?: string;
  maxSteps?: number;
  stateDir?: string;
  directShellApproval?: 'always' | 'never';
  searchIgnoreDirs?: string[];
  agentContextPaths?: string[];
  autopilot?: AutopilotProfile;
};

export type ProjectConfigInitializeResult =
  | {
      created: true;
      configPath: string;
      config: ProjectConfig;
    }
  | {
      created: false;
      configPath: string;
      config: ProjectConfig;
    };
