import type { AwarenessLimit, AwarenessSource } from '../../../types.js';
import type {
  CodingDetectedProject,
  CodingProjectKind,
} from '../types.js';

export type CodingProjectSignalContribution = {
  project: CodingDetectedProject;
  configFiles: string[];
  sources: AwarenessSource[];
  limits: AwarenessLimit[];
};

export type CodingProjectDetectorInput = {
  workspaceRoot: string;
  rootEntries: string[];
  readText: (relativePath: string) => Promise<string | undefined>;
};

export type CodingProjectSignalDetector = {
  id: CodingProjectKind;
  detect(input: CodingProjectDetectorInput): Promise<CodingProjectSignalContribution | null>;
};
