import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, join } from 'node:path';
import type { EvalRunResult, EvalSuiteReport } from './schema.js';

export function writeEvalSuiteReport(report: EvalSuiteReport): { jsonPath: string; markdownPath: string } {
  mkdirSync(report.resultsDir, { recursive: true });
  const jsonPath = join(report.resultsDir, 'report.json');
  const markdownPath = join(report.resultsDir, 'report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, formatEvalSuiteMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
}

export function formatEvalSuiteMarkdown(report: EvalSuiteReport): string {
  const passed = report.results.filter((result) => result.status === 'passed').length;
  const lines = [
    '# Heddle Agent Eval Report',
    '',
    `Target: ${report.target}`,
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Results: ${passed}/${report.results.length} passed`,
    '',
    '| Case | Status | Model | Checks | Outcome | Turns | Mutations | Verification After Mutation |',
    '| --- | --- | --- | ---: | --- | ---: | ---: | ---: |',
    ...report.results.map(formatSummaryRow),
    '',
  ];

  for (const result of report.results) {
    lines.push(...formatRunDetail(result, report.resultsDir), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function formatSummaryRow(result: EvalRunResult): string {
  const passedChecks = result.checks.filter((check) => check.passed).length;
  return [
    result.caseId,
    result.status,
    result.model ?? 'default',
    `${passedChecks}/${result.checks.length}`,
    result.metrics.outcome ?? `exit ${result.agent.exitCode ?? 'unknown'}`,
    String(result.metrics.assistantTurns),
    String(result.metrics.mutations),
    String(result.metrics.verificationCommandsAfterMutation),
  ].map(escapeCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |');
}

function formatRunDetail(result: EvalRunResult, resultsDir: string): string[] {
  const traceFiles = result.artifacts.traceFiles.map((path) => formatPath(path, resultsDir));
  const lines = [
    `## ${result.caseId}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Status | ${escapeCell(result.status)} |`,
    `| Model | ${escapeCell(result.model ?? 'default')} |`,
    `| Max steps | ${escapeCell(String(result.maxSteps ?? 'default'))} |`,
    `| Agent exit | ${escapeCell(`${result.agent.exitCode ?? 'unknown'}${result.agent.timedOut ? ' (timed out)' : ''}`)} |`,
    `| Fixture | ${escapeCell(formatFixture(result))} |`,
    `| Workspace | \`${escapeCell(formatPath(result.workspaceRoot, resultsDir))}\` |`,
    `| Output | \`${escapeCell(formatPath(result.outputDir, resultsDir))}\` |`,
    `| Diff | \`${escapeCell(formatPath(result.artifacts.gitDiffPath, resultsDir))}\` |`,
    `| Git status | \`${escapeCell(formatPath(result.artifacts.gitStatusPath, resultsDir))}\` |`,
    `| Progress | ${result.artifacts.progressPath ? `\`${escapeCell(formatPath(result.artifacts.progressPath, resultsDir))}\`` : 'none'} |`,
    `| Session catalog | ${result.artifacts.sessionCatalogPath ? `\`${escapeCell(formatPath(result.artifacts.sessionCatalogPath, resultsDir))}\`` : 'none'} |`,
    `| Trace files | ${traceFiles.length ? traceFiles.map((path) => `\`${escapeCell(path)}\``).join('<br>') : 'none'} |`,
    '',
    '### Checks',
    '',
  ];

  if (result.checks.length === 0) {
    lines.push('- none');
  } else {
    for (const check of result.checks) {
      lines.push(`- ${check.passed ? 'PASS' : 'FAIL'} ${check.name}: \`${check.command}\` (${check.exitCode ?? 'unknown'}, ${check.durationMs}ms)`);
    }
  }

  lines.push(
    '',
    '### Metrics',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Assistant turns | ${result.metrics.assistantTurns} |`,
    `| Tool calls | ${result.metrics.toolCalls} |`,
    `| Mutations | ${result.metrics.mutations} |`,
    `| Verification after mutation | ${result.metrics.verificationCommandsAfterMutation} |`,
    `| Approvals requested | ${result.metrics.approvalsRequested} |`,
    `| Approvals resolved | ${result.metrics.approvalsResolved} |`,
    `| Tool errors | ${result.metrics.toolErrors} |`,
  );

  if (result.metrics.summary) {
    lines.push('', '### Final Summary', '', result.metrics.summary);
  }

  return lines;
}

function formatFixture(result: EvalRunResult): string {
  if (result.fixture.type === 'git-worktree') {
    return [
      'git-worktree',
      result.fixture.ref ? `ref ${result.fixture.ref}` : undefined,
      result.fixture.resolvedRef ? `commit ${shortSha(result.fixture.resolvedRef)}` : undefined,
      result.fixture.baselineCommit && result.fixture.baselineCommit !== result.fixture.resolvedRef ?
        `baseline ${shortSha(result.fixture.baselineCommit)}`
      : undefined,
    ].filter(Boolean).join(', ');
  }
  return result.fixture.baselineCommit ? `inline, baseline ${shortSha(result.fixture.baselineCommit)}` : 'inline';
}

function shortSha(value: string): string {
  return value.slice(0, 12);
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function formatPath(path: string, basePath: string): string {
  if (path === basePath) {
    return '.';
  }

  const relativePath = relative(basePath, path);
  return relativePath && !relativePath.startsWith('..') ? relativePath : path;
}
