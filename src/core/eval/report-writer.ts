import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
    '| Case | Status | Checks | Outcome | Turns | Mutations | Verification After Mutation |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: |',
    ...report.results.map(formatSummaryRow),
    '',
  ];

  for (const result of report.results) {
    lines.push(...formatRunDetail(result), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function formatSummaryRow(result: EvalRunResult): string {
  const passedChecks = result.checks.filter((check) => check.passed).length;
  return [
    result.caseId,
    result.status,
    `${passedChecks}/${result.checks.length}`,
    result.metrics.outcome ?? `exit ${result.agent.exitCode ?? 'unknown'}`,
    String(result.metrics.assistantTurns),
    String(result.metrics.mutations),
    String(result.metrics.verificationCommandsAfterMutation),
  ].map(escapeCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |');
}

function formatRunDetail(result: EvalRunResult): string[] {
  const lines = [
    `## ${result.caseId}`,
    '',
    `Status: ${result.status}`,
    `Workspace: ${result.workspaceRoot}`,
    `Output: ${result.outputDir}`,
    `Agent exit: ${result.agent.exitCode ?? 'unknown'}${result.agent.timedOut ? ' (timed out)' : ''}`,
    `Diff: ${result.artifacts.gitDiffPath}`,
    `Status file: ${result.artifacts.gitStatusPath}`,
    `Trace files: ${result.artifacts.traceFiles.length ? result.artifacts.traceFiles.join(', ') : 'none'}`,
    '',
    'Checks:',
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
    'Metrics:',
    `- assistant turns: ${result.metrics.assistantTurns}`,
    `- tool calls: ${result.metrics.toolCalls}`,
    `- mutations: ${result.metrics.mutations}`,
    `- verification commands after mutation: ${result.metrics.verificationCommandsAfterMutation}`,
    `- approvals: ${result.metrics.approvalsRequested} requested, ${result.metrics.approvalsResolved} resolved`,
    `- tool errors: ${result.metrics.toolErrors}`,
  );

  if (result.metrics.summary) {
    lines.push(`- summary: ${result.metrics.summary}`);
  }

  return lines;
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
