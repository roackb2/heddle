import type { AwarenessCollectInput, AwarenessLimit, AwarenessSource } from '../../../types.js';
import type { CodingWorkingEnvironment } from '../types.js';
import { collectGitWorkingEnvironment } from './git.js';

export async function collectCodingWorkingEnvironment(input: AwarenessCollectInput): Promise<{
  environment: CodingWorkingEnvironment;
  sources: AwarenessSource[];
  limits: AwarenessLimit[];
}> {
  const sources: AwarenessSource[] = [{
    kind: 'filesystem',
    path: input.workspaceRoot,
    note: 'workspace root',
  }];
  const limits: AwarenessLimit[] = [];

  const gitResult = await collectGitWorkingEnvironment(input.workspaceRoot);
  sources.push(...gitResult.sources);
  limits.push(...gitResult.limits);

  return {
    environment: {
      workspaceRoot: input.workspaceRoot,
      gitRepositoryRoot: gitResult.environment.gitRepositoryRoot,
      gitBranch: gitResult.environment.gitBranch,
      gitShortCommit: gitResult.environment.gitShortCommit,
      isGitRepository: gitResult.environment.isGitRepository,
      isDirty: gitResult.environment.isDirty,
      paths: gitResult.environment.paths,
    },
    sources,
    limits,
  };
}
