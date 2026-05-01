import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectEvalArtifacts, writeTextArtifact } from './git-artifacts.js';
import { prepareEvalWorkspace } from './workspace-fixture.js';
import { runEvalChecks } from './check-runner.js';
import { runCommand } from './process.js';
import { analyzeTraceFiles } from './trace-analyzer.js';
import type { AgentEvalCase, EvalRunResult } from './schema.js';

export type RunAgentEvalCaseArgs = {
  testCase: AgentEvalCase;
  repoRoot: string;
  resultsRoot: string;
  target?: string;
  model?: string;
  maxSteps?: number;
  timeoutMs?: number;
  stateDir?: string;
  workRoot?: string;
  preferApiKey?: boolean;
  dryRun?: boolean;
};

export async function runAgentEvalCase(args: RunAgentEvalCaseArgs): Promise<EvalRunResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const target = args.target ?? 'current';
  const outputDir = join(args.resultsRoot, target, args.testCase.id);
  mkdirSync(outputDir, { recursive: true });

  const prepared = await prepareEvalWorkspace({
    testCase: args.testCase,
    repoRoot: args.repoRoot,
    workRoot: args.workRoot ? resolve(args.workRoot) : undefined,
  });
  const workspaceRoot = prepared.workspaceRoot;
  const model = args.model ?? args.testCase.model;
  const maxSteps = args.maxSteps ?? args.testCase.maxSteps;
  const command = buildHeddleAskCommand({
    workspaceRoot,
    model,
    maxSteps,
    prompt: args.testCase.prompt,
    sessionName: `eval-${args.testCase.id}`,
    preferApiKey: args.preferApiKey,
  });

  const stdoutPath = join(outputDir, 'stdout.txt');
  const stderrPath = join(outputDir, 'stderr.txt');
  const agentResult =
    args.dryRun ?
      {
        command,
        exitCode: 0,
        stdout: `Dry run: ${command.join(' ')}\n`,
        stderr: '',
        durationMs: 0,
        timedOut: false,
      }
    : await runCommand({
        command: command[0] ?? 'yarn',
        args: command.slice(1),
        cwd: args.repoRoot,
        env: {
          ...process.env,
          HEDDLE_EVAL_AUTO_APPROVE: '1',
        },
        timeoutMs: args.timeoutMs ?? 15 * 60_000,
      });
  writeTextArtifact(stdoutPath, agentResult.stdout);
  writeTextArtifact(stderrPath, agentResult.stderr);

  const checks = args.dryRun ? [] : await runEvalChecks({
    checks: args.testCase.checks,
    workspaceRoot,
  });
  const artifacts = await collectEvalArtifacts({
    workspaceRoot,
    outputDir,
    stateDir: args.stateDir,
  });
  const metrics = analyzeTraceFiles(artifacts.traceFiles);
  const finishedAtMs = Date.now();
  const status =
    agentResult.exitCode === 0
    && !agentResult.timedOut
    && checks.every((check) => check.passed) ?
      'passed'
    : 'failed';

  const result: EvalRunResult = {
    caseId: args.testCase.id,
    target,
    status,
    workspaceRoot,
    outputDir,
    fixture: prepared.fixture,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    agent: {
      command,
      exitCode: agentResult.exitCode,
      stdoutPath,
      stderrPath,
      timedOut: agentResult.timedOut,
    },
    artifacts,
    checks,
    metrics,
    model,
    maxSteps,
  };
  writeTextArtifact(join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function buildHeddleAskCommand(args: {
  workspaceRoot: string;
  model?: string;
  maxSteps?: number;
  prompt: string;
  sessionName: string;
  preferApiKey?: boolean;
}): string[] {
  return [
    'yarn',
    '-s',
    'cli:dev',
    '--cwd',
    args.workspaceRoot,
    '--force-owner-conflict',
    ...(args.model ? ['--model', args.model] : []),
    ...(args.maxSteps ? ['--max-steps', String(args.maxSteps)] : []),
    ...(args.preferApiKey ? ['--prefer-api-key'] : []),
    'ask',
    '--new-session',
    args.sessionName,
    args.prompt,
  ];
}
