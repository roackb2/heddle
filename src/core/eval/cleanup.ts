import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type EvalCleanupCandidate = {
  path: string;
  name: string;
  modifiedAt: string;
  modifiedAtMs: number;
};

export type EvalCleanupResult = {
  resultsDir: string;
  before?: string;
  dryRun: boolean;
  candidates: EvalCleanupCandidate[];
  removed: EvalCleanupCandidate[];
};

export function cleanupEvalResults(args: {
  resultsDir: string;
  before?: Date;
  dryRun?: boolean;
}): EvalCleanupResult {
  const resultsDir = resolve(args.resultsDir);
  const candidates = listEvalResultDirs(resultsDir)
    .filter((candidate) => !args.before || candidate.modifiedAtMs < args.before.getTime())
    .sort((left, right) => left.modifiedAtMs - right.modifiedAtMs);
  const dryRun = args.dryRun ?? true;
  const removed: EvalCleanupCandidate[] = [];

  if (!dryRun) {
    for (const candidate of candidates) {
      rmSync(candidate.path, { recursive: true, force: true });
      removed.push(candidate);
    }
  }

  return {
    resultsDir,
    before: args.before?.toISOString(),
    dryRun,
    candidates,
    removed,
  };
}

export function listEvalResultDirs(resultsDir: string): EvalCleanupCandidate[] {
  const resolved = resolve(resultsDir);
  if (!existsSync(resolved)) {
    return [];
  }

  return readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(resolved, entry.name);
      const stat = statSync(path);
      return {
        path,
        name: entry.name,
        modifiedAt: stat.mtime.toISOString(),
        modifiedAtMs: stat.mtimeMs,
      };
    });
}
