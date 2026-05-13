import type { AwarenessCollectInput, AwarenessLimit, AwarenessSource } from '../../../types.js';
import type {
  CodingInspectionSurface,
  CodingProjectSignals,
  CodingWorkingEnvironment,
  CodingWorkspaceTree,
} from '../types.js';
import { collectGitWorkingEnvironment } from './git.js';
import { collectCodingProjectSignals } from './project-signals.js';
import { collectCodingWorkspaceTree } from './workspace-tree.js';

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

export async function collectCodingProjectDashboard(input: AwarenessCollectInput): Promise<{
  environment: CodingWorkingEnvironment;
  workspaceTree: CodingWorkspaceTree;
  projectSignals: CodingProjectSignals;
  inspectionSurfaces: CodingInspectionSurface[];
  sources: AwarenessSource[];
  limits: AwarenessLimit[];
}> {
  const environmentResult = await collectCodingWorkingEnvironment(input);
  const [treeResult, projectSignalsResult] = await Promise.all([
    collectCodingWorkspaceTree({
      workspaceRoot: input.workspaceRoot,
      maxDepth: input.maxDepth,
      maxEntries: input.maxEntries,
    }),
    collectCodingProjectSignals({
      workspaceRoot: input.workspaceRoot,
      environment: environmentResult.environment,
    }),
  ]);

  return {
    environment: environmentResult.environment,
    workspaceTree: treeResult.tree,
    projectSignals: projectSignalsResult.projectSignals,
    inspectionSurfaces: projectSignalsResult.inspectionSurfaces,
    sources: mergeSources(environmentResult.sources, treeResult.sources, projectSignalsResult.sources),
    limits: [...environmentResult.limits, ...treeResult.limits, ...projectSignalsResult.limits],
  };
}

function mergeSources(
  ...sourceGroups: AwarenessSource[][]
): AwarenessSource[] {
  const seen = new Set<string>();
  const merged: AwarenessSource[] = [];

  for (const sources of sourceGroups) {
    for (const source of sources) {
      const key = `${source.kind}|${source.command ?? ''}|${source.path ?? ''}|${source.note ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(source);
    }
  }

  return merged;
}
