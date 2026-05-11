import { execFile } from 'node:child_process';
import type { AwarenessLimit, AwarenessSource } from '../../../types.js';
import type { CodingWorkingEnvironment } from '../types.js';

type GitCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RawStatusEntry = {
  path: string;
  oldPath?: string;
  indexStatus: string;
  workingTreeStatus: string;
};

export async function collectGitWorkingEnvironment(workspaceRoot: string): Promise<{
  environment: Omit<CodingWorkingEnvironment, 'workspaceRoot'>;
  sources: AwarenessSource[];
  limits: AwarenessLimit[];
}> {
  const sources: AwarenessSource[] = [];
  const limits: AwarenessLimit[] = [];

  const insideWorkTree = await runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']);
  sources.push({ kind: 'git', command: 'git rev-parse --is-inside-work-tree' });
  if (insideWorkTree.exitCode !== 0 || insideWorkTree.stdout.trim() !== 'true') {
    limits.push({
      kind: 'not_applicable',
      subject: 'git',
      detail: 'Workspace is not inside a git work tree.',
    });
    return {
      environment: createNonGitEnvironment(),
      sources,
      limits,
    };
  }

  const [repoRootResult, branchResult, commitResult, statusResult] = await Promise.all([
    runGit(workspaceRoot, ['rev-parse', '--show-toplevel']),
    runGit(workspaceRoot, ['branch', '--show-current']),
    runGit(workspaceRoot, ['rev-parse', '--short', 'HEAD']),
    runGit(workspaceRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ]);

  sources.push(
    { kind: 'git', command: 'git rev-parse --show-toplevel' },
    { kind: 'git', command: 'git branch --show-current' },
    { kind: 'git', command: 'git rev-parse --short HEAD' },
    { kind: 'git', command: 'git status --porcelain=v1 -z --untracked-files=all' },
  );

  if (repoRootResult.exitCode !== 0) {
    limits.push({
      kind: 'unavailable',
      subject: 'git repository root',
      detail: normalizeError(repoRootResult.stderr) ?? 'Unable to resolve git repository root.',
    });
  }
  if (branchResult.exitCode !== 0) {
    limits.push({
      kind: 'unavailable',
      subject: 'git branch',
      detail: normalizeError(branchResult.stderr) ?? 'Unable to resolve current git branch.',
    });
  }
  if (commitResult.exitCode !== 0) {
    limits.push({
      kind: 'unavailable',
      subject: 'git commit',
      detail: normalizeError(commitResult.stderr) ?? 'Unable to resolve current git commit.',
    });
  }
  if (statusResult.exitCode !== 0) {
    limits.push({
      kind: 'unavailable',
      subject: 'git status',
      detail: normalizeError(statusResult.stderr) ?? 'Unable to resolve git working tree status.',
    });
  }

  const parsedStatus = statusResult.exitCode === 0 ? parsePorcelainStatus(statusResult.stdout) : [];
  const groupedStatus = groupPaths(parsedStatus);
  const boundedStatus = applyPathLimits(groupedStatus.paths);
  const paths = boundedStatus.paths;
  const isDirty =
    paths.staged.length > 0 ||
    paths.modified.length > 0 ||
    paths.deleted.length > 0 ||
    paths.untracked.length > 0 ||
    paths.renamed.length > 0;

  if (groupedStatus.omittedCount > 0) {
    limits.push({
      kind: 'omitted',
      subject: 'git working tree paths',
      detail: `Omitted ${groupedStatus.omittedCount} runtime or dependency path entries such as .heddle, .git, node_modules, dist, coverage, and cache folders.`,
    });
  }
  limits.push(...boundedStatus.limits);

  return {
    environment: {
      gitRepositoryRoot: repoRootResult.exitCode === 0 ? repoRootResult.stdout.trim() || undefined : undefined,
      gitBranch: branchResult.exitCode === 0 ? branchResult.stdout.trim() || undefined : undefined,
      gitShortCommit: commitResult.exitCode === 0 ? commitResult.stdout.trim() || undefined : undefined,
      isGitRepository: true,
      isDirty,
      paths,
    },
    sources,
    limits,
  };
}

function createNonGitEnvironment(): Omit<CodingWorkingEnvironment, 'workspaceRoot'> {
  return {
    isGitRepository: false,
    isDirty: false,
    paths: {
      staged: [],
      modified: [],
      deleted: [],
      untracked: [],
      renamed: [],
    },
  };
}

function groupPaths(entries: RawStatusEntry[]): {
  paths: CodingWorkingEnvironment['paths'];
  omittedCount: number;
} {
  const staged = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();
  const untracked = new Set<string>();
  const renamed = new Map<string, string>();
  let omittedCount = 0;

  for (const entry of entries) {
    if (isNoisePath(entry.path) || (entry.oldPath && isNoisePath(entry.oldPath))) {
      omittedCount += 1;
      continue;
    }

    if (entry.indexStatus === '?' && entry.workingTreeStatus === '?') {
      untracked.add(entry.path);
      continue;
    }

    if (entry.indexStatus === 'R' && entry.oldPath) {
      renamed.set(entry.oldPath, entry.path);
    }

    if (entry.indexStatus !== ' ' && entry.indexStatus !== '?' && entry.indexStatus !== 'D' && entry.indexStatus !== 'R') {
      staged.add(entry.path);
    }
    if (entry.workingTreeStatus === 'M') {
      modified.add(entry.path);
    }
    if (entry.indexStatus === 'D' || entry.workingTreeStatus === 'D') {
      deleted.add(entry.path);
    }
    if (entry.indexStatus === 'M') {
      staged.add(entry.path);
    }
    if (entry.indexStatus === 'A') {
      staged.add(entry.path);
    }
  }

  for (const deletedPath of deleted) {
    staged.delete(deletedPath);
    modified.delete(deletedPath);
  }

  return {
    paths: {
      staged: [...staged].sort(),
      modified: [...modified].sort(),
      deleted: [...deleted].sort(),
      untracked: [...untracked].sort(),
      renamed: [...renamed.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([from, to]) => ({ from, to })),
    },
    omittedCount,
  };
}

function isNoisePath(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  return segments.some((segment) => OMITTED_PATH_SEGMENTS.has(segment));
}

const OMITTED_PATH_SEGMENTS = new Set([
  '.git',
  '.heddle',
  'node_modules',
  'dist',
  'coverage',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'test-results',
]);

const MAX_PATHS_PER_GROUP = 20;

function applyPathLimits(paths: CodingWorkingEnvironment['paths']): {
  paths: CodingWorkingEnvironment['paths'];
  limits: AwarenessLimit[];
} {
  const limits: AwarenessLimit[] = [];

  const staged = truncatePathGroup(paths.staged, 'staged paths', limits);
  const modified = truncatePathGroup(paths.modified, 'modified paths', limits);
  const deleted = truncatePathGroup(paths.deleted, 'deleted paths', limits);
  const untracked = truncatePathGroup(paths.untracked, 'untracked paths', limits);
  const renamed = truncateRenamedGroup(paths.renamed, limits);

  return {
    paths: {
      staged,
      modified,
      deleted,
      untracked,
      renamed,
    },
    limits,
  };
}

function truncatePathGroup(paths: string[], subject: string, limits: AwarenessLimit[]): string[] {
  if (paths.length <= MAX_PATHS_PER_GROUP) {
    return paths;
  }

  const omittedCount = paths.length - MAX_PATHS_PER_GROUP;
  limits.push({
    kind: 'truncated',
    subject,
    detail: `Showing ${MAX_PATHS_PER_GROUP} of ${paths.length} entries; ${omittedCount} more omitted from the summary.`,
  });
  return paths.slice(0, MAX_PATHS_PER_GROUP);
}

function truncateRenamedGroup(
  paths: Array<{ from: string; to: string }>,
  limits: AwarenessLimit[],
): Array<{ from: string; to: string }> {
  if (paths.length <= MAX_PATHS_PER_GROUP) {
    return paths;
  }

  const omittedCount = paths.length - MAX_PATHS_PER_GROUP;
  limits.push({
    kind: 'truncated',
    subject: 'renamed paths',
    detail: `Showing ${MAX_PATHS_PER_GROUP} of ${paths.length} entries; ${omittedCount} more omitted from the summary.`,
  });
  return paths.slice(0, MAX_PATHS_PER_GROUP);
}

function parsePorcelainStatus(stdout: string): RawStatusEntry[] {
  const parts = stdout.split('\0').filter(Boolean);
  const entries: RawStatusEntry[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const raw = parts[index] ?? '';
    if (raw.length < 4) {
      continue;
    }

    const indexStatus = raw[0] ?? ' ';
    const workingTreeStatus = raw[1] ?? ' ';
    const path = raw.slice(3);
    if (!path) {
      continue;
    }

    if ((indexStatus === 'R' || indexStatus === 'C') && parts[index + 1]) {
      entries.push({
        path,
        oldPath: parts[index + 1],
        indexStatus,
        workingTreeStatus,
      });
      index += 1;
      continue;
    }

    entries.push({ path, oldPath: undefined, indexStatus, workingTreeStatus });
  }

  return entries;
}

function normalizeError(stderr: string): string | undefined {
  const trimmed = stderr.trim();
  return trimmed || undefined;
}

function runGit(cwd: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolveResult) => {
    execFile('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === 'number'
        ? (error as { code: number }).code
        : error ? 1 : 0;
      resolveResult({
        exitCode: code,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      });
    });
  });
}
