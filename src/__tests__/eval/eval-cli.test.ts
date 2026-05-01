import { describe, expect, it } from 'vitest';
import { parseEvalArgs } from '../../cli/eval/index.js';

describe('parseEvalArgs', () => {
  it('parses agent eval options', () => {
    const parsed = parseEvalArgs([
      'agent',
      '--cases-dir',
      'evals/cases/coding',
      '--case',
      'fix-failing-test',
      '--output',
      'evals/results/test',
      '--target',
      'current',
      '--timeout-ms',
      '1000',
      '--dry-run',
    ]);

    expect(parsed).toMatchObject({
      command: 'agent',
      caseIds: ['fix-failing-test'],
      target: 'current',
      timeoutMs: 1000,
      dryRun: true,
    });
    expect(parsed.casesDir).toContain('evals/cases/coding');
    expect(parsed.outputDir).toContain('evals/results/test');
  });

  it('returns help for unknown eval subcommands', () => {
    expect(parseEvalArgs(['other']).command).toBe('help');
  });
});
