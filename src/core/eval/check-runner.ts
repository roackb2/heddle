import { runShellCommand } from './process.js';
import type { EvalCheck, EvalCheckResult } from './schema.js';

export async function runEvalChecks(args: {
  checks: EvalCheck[];
  workspaceRoot: string;
}): Promise<EvalCheckResult[]> {
  const results: EvalCheckResult[] = [];
  for (const check of args.checks) {
    const result = await runShellCommand({
      command: check.command,
      cwd: args.workspaceRoot,
      timeoutMs: check.timeoutMs,
    });
    results.push({
      name: check.name ?? check.command,
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
