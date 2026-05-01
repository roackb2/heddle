import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupEvalResults, listEvalResultDirs } from '../../core/eval/cleanup.js';

describe('eval cleanup', () => {
  it('previews matching result directories without deleting by default', () => {
    const resultsDir = mkdtempSync(join(tmpdir(), 'heddle-eval-clean-'));
    const oldRun = createResultDir(resultsDir, 'agent-old', new Date('2026-04-30T00:00:00Z'));
    const newRun = createResultDir(resultsDir, 'agent-new', new Date('2026-05-02T00:00:00Z'));

    const result = cleanupEvalResults({
      resultsDir,
      before: new Date('2026-05-01T00:00:00Z'),
    });

    expect(result.dryRun).toBe(true);
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(['agent-old']);
    expect(result.removed).toEqual([]);
    expect(existsSync(oldRun)).toBe(true);
    expect(existsSync(newRun)).toBe(true);
  });

  it('deletes only directories before the cutoff when dryRun is false', () => {
    const resultsDir = mkdtempSync(join(tmpdir(), 'heddle-eval-clean-'));
    const oldRun = createResultDir(resultsDir, 'agent-old', new Date('2026-04-30T00:00:00Z'));
    const newRun = createResultDir(resultsDir, 'agent-new', new Date('2026-05-02T00:00:00Z'));

    const result = cleanupEvalResults({
      resultsDir,
      before: new Date('2026-05-01T00:00:00Z'),
      dryRun: false,
    });

    expect(result.candidates.map((candidate) => candidate.name)).toEqual(['agent-old']);
    expect(result.removed.map((candidate) => candidate.name)).toEqual(['agent-old']);
    expect(existsSync(oldRun)).toBe(false);
    expect(existsSync(newRun)).toBe(true);
  });

  it('ignores files and missing result directories', () => {
    const resultsDir = mkdtempSync(join(tmpdir(), 'heddle-eval-clean-'));
    writeFileSync(join(resultsDir, 'report.md'), '# Report\n');

    expect(listEvalResultDirs(join(resultsDir, 'missing'))).toEqual([]);
    expect(listEvalResultDirs(resultsDir)).toEqual([]);
  });
});

function createResultDir(resultsDir: string, name: string, modifiedAt: Date) {
  const path = join(resultsDir, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'report.md'), '# Report\n');
  utimesSync(path, modifiedAt, modifiedAt);
  return path;
}
