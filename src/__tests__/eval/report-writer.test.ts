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
          gitStatusPath: '/out/git-status.txt',
          gitDiffPath: '/out/diff.patch',
          traceFiles: ['/tmp/workspace/.heddle/traces/trace.json'],
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
      }],
    };

    const markdown = formatEvalSuiteMarkdown(report);

    expect(markdown).toContain('Results: 1/1 passed');
    expect(markdown).toContain('| fix-failing-test | passed | 1/1 | done | 3 | 1 | 1 |');
    expect(markdown).toContain('- PASS unit test: `yarn test`');
  });
});
