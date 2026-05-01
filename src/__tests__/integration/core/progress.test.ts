import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvalProgressReporter, type EvalProgressEvent } from '../../../core/eval/progress.js';

describe('EvalProgressReporter', () => {
  it('writes started and completed events to progress jsonl', async () => {
    const progressPath = join(mkdtempSync(join(tmpdir(), 'heddle-progress-')), 'progress.jsonl');
    const reporter = new EvalProgressReporter({
      caseId: 'progress-case',
      progressPath,
      writeStdout: false,
    });

    const result = await reporter.track({
      phase: 'setup',
      message: 'run setup',
      heartbeatMs: 0,
      run: async () => 'ok',
    });

    expect(result).toBe('ok');
    expect(readEvents(progressPath)).toMatchObject([
      {
        caseId: 'progress-case',
        phase: 'setup',
        status: 'started',
        message: 'run setup',
      },
      {
        caseId: 'progress-case',
        phase: 'setup',
        status: 'completed',
        message: 'run setup',
      },
    ]);
  });

  it('records failed phases before rethrowing', async () => {
    const progressPath = join(mkdtempSync(join(tmpdir(), 'heddle-progress-')), 'progress.jsonl');
    const reporter = new EvalProgressReporter({
      caseId: 'progress-case',
      progressPath,
      writeStdout: false,
    });

    await expect(reporter.track({
      phase: 'agent',
      message: 'run agent',
      heartbeatMs: 0,
      run: async () => {
        throw new Error('agent failed');
      },
    })).rejects.toThrow('agent failed');

    expect(readEvents(progressPath).at(-1)).toMatchObject({
      caseId: 'progress-case',
      phase: 'agent',
      status: 'failed',
      message: 'agent failed',
    });
  });
});

function readEvents(progressPath: string): EvalProgressEvent[] {
  return readFileSync(progressPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as EvalProgressEvent);
}
