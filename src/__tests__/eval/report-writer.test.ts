import { describe, expect, it } from 'vitest';
import { formatEvalSuiteMarkdown } from '../../core/eval/report-writer.js';
import type { EvalSuiteReport } from '../../core/eval/schema.js';

describe('formatEvalSuiteMarkdown', () => {
  it('renders a compact suite summary and case details', () => {
    const report: EvalSuiteReport = {
      version: 1,
      target: 'current',
      repoRoot: '/repo',
      startedAt: '2026-05-01T00:00:00.000Z',
      finishedAt: '2026-05-01T00:01:00.000Z',
      resultsDir: '/repo/evals/results/run',
      results: [{
        caseId: 'fix-failing-test',
        target: 'current',
        status: 'passed',
        workspaceRoot: '/tmp/workspace',
        outputDir: '/repo/evals/results/run/current/fix-failing-test',
        fixture: {
          type: 'inline',
          baselineCommit: '1234567890abcdef',
        },
        startedAt: '2026-05-01T00:00:00.000Z',
        finishedAt: '2026-05-01T00:01:00.000Z',
        durationMs: 60_000,
        agent: {
          command: ['yarn', 'cli:dev'],
          exitCode: 0,
          stdoutPath: '/out/stdout.txt',
          stderrPath: '/out/stderr.txt',
          timedOut: false,
        },
        artifacts: {
          gitStatusPath: '/repo/evals/results/run/current/fix-failing-test/git-status.txt',
          gitDiffPath: '/repo/evals/results/run/current/fix-failing-test/diff.patch',
          sessionCatalogPath: '/repo/evals/results/run/current/fix-failing-test/session-catalog.json',
          traceFiles: ['/repo/evals/results/run/current/fix-failing-test/traces/trace.json'],
        },
        checks: [{
          name: 'unit test',
          command: 'yarn test',
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          durationMs: 100,
          passed: true,
          timedOut: false,
        }],
        metrics: {
          assistantTurns: 3,
          toolCalls: 4,
          toolResults: 4,
          mutations: 1,
          approvalsRequested: 1,
          approvalsResolved: 1,
          toolErrors: 0,
          verificationCommandsAfterMutation: 1,
          outcome: 'done',
          summary: 'Fixed.',
          toolsByName: {},
          readOrSearchBeforeMutation: [],
        },
        model: 'gpt-5.4',
        maxSteps: 60,
      }],
    };

    const markdown = formatEvalSuiteMarkdown(report);

    expect(markdown).toContain('Results: 1/1 passed');
    expect(markdown).toContain('| fix-failing-test | passed | gpt-5.4 | 1/1 | done | 3 | 1 | 1 |');
    expect(markdown).toContain('| Model | gpt-5.4 |');
    expect(markdown).toContain('| Max steps | 60 |');
    expect(markdown).toContain('| Fixture | inline, baseline 1234567890ab |');
    expect(markdown).toContain('| Output | `current/fix-failing-test` |');
    expect(markdown).toContain('| Diff | `current/fix-failing-test/diff.patch` |');
    expect(markdown).toContain('| Trace files | `current/fix-failing-test/traces/trace.json` |');
    expect(markdown).toContain('### Metrics');
    expect(markdown).toContain('| Assistant turns | 3 |');
    expect(markdown).toContain('- PASS unit test: `yarn test`');
  });
});
