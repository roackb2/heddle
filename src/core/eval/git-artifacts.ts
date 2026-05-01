import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runCommand } from './process.js';
import type { EvalChangedFile } from './schema.js';

export type GitArtifacts = {
  gitStatusPath: string;
  gitDiffPath: string;
  gitDiffStatPath: string;
  changedFilesPath: string;
  sessionCatalogPath?: string;
  traceFiles: string[];
  changedFiles: EvalChangedFile[];
};

export type UntrackedEvalFile = {
  path: string;
  additions?: number;
};

export async function collectEvalArtifacts(args: {
  workspaceRoot: string;
  outputDir: string;
  stateDir?: string;
}): Promise<GitArtifacts> {
  mkdirSync(args.outputDir, { recursive: true });
  const status = await runCommand({
    command: 'git',
    args: ['status', '--porcelain'],
    cwd: args.workspaceRoot,
    timeoutMs: 10_000,
  });
  const diff = await runCommand({
    command: 'git',
    args: ['diff', '--binary'],
    cwd: args.workspaceRoot,
    timeoutMs: 10_000,
  });
  const diffStat = await runCommand({
    command: 'git',
    args: ['diff', '--stat', '--compact-summary'],
    cwd: args.workspaceRoot,
    timeoutMs: 10_000,
  });
  const numStat = await runCommand({
    command: 'git',
    args: ['diff', '--numstat'],
    cwd: args.workspaceRoot,
    timeoutMs: 10_000,
  });
  const nameStatus = await runCommand({
    command: 'git',
    args: ['diff', '--name-status'],
    cwd: args.workspaceRoot,
    timeoutMs: 10_000,
  });
  const untrackedFiles = await collectUntrackedFiles(args.workspaceRoot);
  const untrackedDiffs = await collectUntrackedDiffs({
    workspaceRoot: args.workspaceRoot,
    files: untrackedFiles,
  });
  const untrackedStats = await collectUntrackedStats({
    workspaceRoot: args.workspaceRoot,
    files: untrackedFiles,
  });
  const gitStatusPath = join(args.outputDir, 'git-status.txt');
  const gitDiffPath = join(args.outputDir, 'diff.patch');
  const gitDiffStatPath = join(args.outputDir, 'diff-stat.txt');
  const changedFilesPath = join(args.outputDir, 'changed-files.json');
  const changedFiles = parseChangedFiles({
    nameStatus: nameStatus.stdout,
    numStat: numStat.stdout,
    untrackedFiles,
  });
  writeFileSync(gitStatusPath, status.stdout, 'utf8');
  writeFileSync(gitDiffPath, joinArtifactText([diff.stdout, ...untrackedDiffs]), 'utf8');
  writeFileSync(gitDiffStatPath, joinArtifactText([diffStat.stdout, ...untrackedStats]), 'utf8');
  writeFileSync(changedFilesPath, `${JSON.stringify(changedFiles, null, 2)}\n`, 'utf8');

  const stateRoot = join(args.workspaceRoot, args.stateDir ?? '.heddle');
  const sessionCatalog = join(stateRoot, 'chat-sessions.catalog.json');
  const sessionCatalogPath = copyOptionalArtifact(sessionCatalog, join(args.outputDir, 'session-catalog.json'));
  const traceFiles = copyTraceFiles({
    sourceTraceDir: join(stateRoot, 'traces'),
    outputTraceDir: join(args.outputDir, 'traces'),
  });

  return {
    gitStatusPath,
    gitDiffPath,
    gitDiffStatPath,
    changedFilesPath,
    sessionCatalogPath,
    traceFiles,
    changedFiles,
  };
}

export function parseChangedFiles(args: {
  nameStatus: string;
  numStat: string;
  untrackedFiles?: UntrackedEvalFile[];
}): EvalChangedFile[] {
  const statsByPath = new Map<string, Pick<EvalChangedFile, 'additions' | 'deletions'>>();
  for (const line of args.numStat.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const [additions, deletions, ...pathParts] = line.split('\t');
    const path = pathParts.at(-1);
    if (!path) {
      continue;
    }
    statsByPath.set(path, {
      additions: parseStatCount(additions),
      deletions: parseStatCount(deletions),
    });
  }

  const trackedFiles = args.nameStatus.split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [status, ...pathParts] = line.split('\t');
      const path = pathParts.at(-1) ?? '';
      return {
        path,
        status,
        ...statsByPath.get(path),
      };
    })
    .filter((file) => file.path.length > 0);
  const trackedPaths = new Set(trackedFiles.map((file) => file.path));
  const untrackedFiles = (args.untrackedFiles ?? [])
    .filter((file) => file.path.length > 0 && !trackedPaths.has(file.path))
    .map((file) => ({
      path: file.path,
      status: '??',
      additions: file.additions,
      deletions: 0,
    }));
  return [...trackedFiles, ...untrackedFiles];
}

function parseStatCount(value: string | undefined): number | undefined {
  if (!value || value === '-') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function collectUntrackedFiles(workspaceRoot: string): Promise<UntrackedEvalFile[]> {
  const result = await runCommand({
    command: 'git',
    args: ['ls-files', '--others', '--exclude-standard'],
    cwd: workspaceRoot,
    timeoutMs: 10_000,
  });
  return result.stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort()
    .map((path) => ({
      path,
      additions: countTextLines(join(workspaceRoot, path)),
    }));
}

async function collectUntrackedDiffs(args: {
  workspaceRoot: string;
  files: UntrackedEvalFile[];
}): Promise<string[]> {
  const patches = [];
  for (const file of args.files) {
    const result = await runCommand({
      command: 'git',
      args: ['diff', '--binary', '--no-index', '--', '/dev/null', file.path],
      cwd: args.workspaceRoot,
      timeoutMs: 10_000,
    });
    patches.push(result.stdout);
  }
  return patches;
}

async function collectUntrackedStats(args: {
  workspaceRoot: string;
  files: UntrackedEvalFile[];
}): Promise<string[]> {
  const stats = [];
  for (const file of args.files) {
    const result = await runCommand({
      command: 'git',
      args: ['diff', '--stat', '--compact-summary', '--no-index', '--', '/dev/null', file.path],
      cwd: args.workspaceRoot,
      timeoutMs: 10_000,
    });
    stats.push(result.stdout);
  }
  return stats;
}

function joinArtifactText(parts: string[]): string {
  return parts
    .map((part) => part.trimEnd())
    .filter((part) => part.length > 0)
    .join('\n\n');
}

function countTextLines(path: string): number | undefined {
  try {
    const content = readFileSync(path, 'utf8');
    if (content.length === 0) {
      return 0;
    }
    const lines = content.split(/\r?\n/);
    return content.endsWith('\n') ? lines.length - 1 : lines.length;
  } catch {
    return undefined;
  }
}

export function writeTextArtifact(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

function listTraceFiles(traceDir: string): string[] {
  if (!existsSync(traceDir)) {
    return [];
  }
  return readdirSync(traceDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => join(traceDir, file))
    .sort();
}

function copyOptionalArtifact(sourcePath: string, targetPath: string): string | undefined {
  if (!existsSync(sourcePath)) {
    return undefined;
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function copyTraceFiles(args: { sourceTraceDir: string; outputTraceDir: string }): string[] {
  return listTraceFiles(args.sourceTraceDir).map((sourcePath) => {
    const targetPath = join(args.outputTraceDir, basename(sourcePath));
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    return targetPath;
  });
}
