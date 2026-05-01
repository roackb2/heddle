import { runShellCommand } from './process.js';
import type { EvalProgressReporter } from './progress.js';
import type { EvalCheck, EvalCheckResult } from './schema.js';

export async function runEvalChecks(args: {
  checks: EvalCheck[];
  workspaceRoot: string;
  progress?: EvalProgressReporter;
}): Promise<EvalCheckResult[]> {
  const results: EvalCheckResult[] = [];
  for (const check of args.checks) {
    const name = check.name ?? check.command;
    const result = await args.progress?.track({
      phase: 'checks.command',
      message: `run check: ${name}`,
      heartbeatMessage: `still running check: ${name}`,
      run: () => runShellCommand({
        command: check.command,
        cwd: args.workspaceRoot,
        timeoutMs: check.timeoutMs,
      }),
    }) ?? await runShellCommand({
      command: check.command,
      cwd: args.workspaceRoot,
      timeoutMs: check.timeoutMs,
    });
    results.push({
      name,
      command: check.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      passed: result.exitCode === 0 && !result.timedOut,
      timedOut: result.timedOut,
    });
  }
  return results;
}
