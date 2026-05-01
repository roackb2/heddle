import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runCommand } from './process.js';

export type GitArtifacts = {
  gitStatusPath: string;
  gitDiffPath: string;
  sessionCatalogPath?: string;
  traceFiles: string[];
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
  const gitStatusPath = join(args.outputDir, 'git-status.txt');
  const gitDiffPath = join(args.outputDir, 'diff.patch');
  writeFileSync(gitStatusPath, status.stdout, 'utf8');
  writeFileSync(gitDiffPath, diff.stdout, 'utf8');

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
    sessionCatalogPath,
    traceFiles,
  };
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
