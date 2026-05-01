import { describe, expect, it } from 'vitest';
import { parseEvalArgs } from '../../../cli/eval/index.js';

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
      '--fixture-ref',
      'v0.0.37',
      '--timeout-ms',
      '1000',
      '--dry-run',
    ]);

    expect(parsed).toMatchObject({
      command: 'agent',
      caseIds: ['fix-failing-test'],
      target: 'current',
      fixtureRef: 'v0.0.37',
      timeoutMs: 1000,
      dryRun: true,
    });
    expect(parsed.casesDir).toContain('evals/cases/coding');
    expect(parsed.outputDir).toContain('evals/results/test');
  });

  it('returns help for unknown eval subcommands', () => {
    expect(parseEvalArgs(['other']).command).toBe('help');
  });

  it('parses clean eval options', () => {
    const parsed = parseEvalArgs([
      'clean',
      '--results-dir',
      'evals/results',
      '--before',
      '2026-05-01T00:00:00Z',
      '--yes',
    ]);

    expect(parsed).toMatchObject({
      command: 'clean',
      yes: true,
    });
    expect(parsed.resultsDir).toContain('evals/results');
    expect(parsed.before?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('uses a readable repo-local default output path', () => {
    const parsed = parseEvalArgs(['agent', '--cases-dir', 'evals/cases/coding']);

    expect(parsed.outputDir).toMatch(/evals\/results\/agent-\d{4}-\d{2}-\d{2}-\d{6}$/);
  });
});
