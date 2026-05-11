import { formatAwarenessMetadata } from '../../format.js';
import type { CodingAwarenessSnapshot, CodingWorkingEnvironment } from './types.js';

export function formatCodingWorkingEnvironmentSnapshot(snapshot: CodingAwarenessSnapshot): string {
  const section = snapshot.sections.find((candidate) => candidate.type === 'working_environment');
  if (!section) {
    return [
      `Working environment for ${snapshot.workspaceRoot}`,
      formatAwarenessMetadata({
        collectedAt: snapshot.collectedAt,
        sources: snapshot.sources,
        limits: snapshot.limits,
      }),
    ].join('\n\n');
  }

  const environment = section.data;
  const lines = [
    `Working environment for ${environment.workspaceRoot}`,
    `Git repository: ${environment.isGitRepository ? 'yes' : 'no'}`,
  ];

  if (environment.gitRepositoryRoot) {
    lines.push(`Git repo root: ${environment.gitRepositoryRoot}`);
  }
  if (environment.gitBranch) {
    lines.push(`Branch: ${environment.gitBranch}`);
  }
  if (environment.gitShortCommit) {
    lines.push(`Short commit: ${environment.gitShortCommit}`);
  }
  lines.push(`Dirty: ${environment.isDirty ? 'yes' : 'no'}`);

  appendPathGroup(lines, 'Staged paths', environment.paths.staged);
  appendPathGroup(lines, 'Modified paths', environment.paths.modified);
  appendPathGroup(lines, 'Deleted paths', environment.paths.deleted);
  appendPathGroup(lines, 'Untracked paths', environment.paths.untracked);
  appendRenamedGroup(lines, environment);

  lines.push('', formatAwarenessMetadata({
    collectedAt: snapshot.collectedAt,
    sources: snapshot.sources,
    limits: snapshot.limits,
  }));

  return lines.join('\n');
}

function appendPathGroup(lines: string[], label: string, paths: string[]): void {
  lines.push(`${label}: ${paths.length > 0 ? paths.join(', ') : '(none)'}`);
}

function appendRenamedGroup(lines: string[], environment: CodingWorkingEnvironment): void {
  if (environment.paths.renamed.length === 0) {
    lines.push('Renamed paths: (none)');
    return;
  }

  lines.push(`Renamed paths: ${environment.paths.renamed.map((entry) => `${entry.from} -> ${entry.to}`).join(', ')}`);
}
