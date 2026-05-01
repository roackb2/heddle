import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runCommand, runShellCommand } from './process.js';
import type { AgentEvalCase, EvalCheckResult } from './schema.js';

export type PreparedEvalWorkspace = {
  workspaceRoot: string;
  setupResults: EvalCheckResult[];
};

export async function prepareEvalWorkspace(args: {
  testCase: AgentEvalCase;
  repoRoot: string;
  workRoot?: string;
}): Promise<PreparedEvalWorkspace> {
  const parent = args.workRoot ? resolve(args.workRoot) : mkdtempSync(join(tmpdir(), 'heddle-eval-'));
  mkdirSync(parent, { recursive: true });
  const workspaceRoot = join(parent, args.testCase.id);
  rmSync(workspaceRoot, { recursive: true, force: true });
  mkdirSync(workspaceRoot, { recursive: true });

  for (const [relativePath, content] of Object.entries(args.testCase.setup.files ?? {})) {
    const path = join(workspaceRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }

  const setupResults: EvalCheckResult[] = [];
  for (const command of args.testCase.setup.commands ?? []) {
    const result = await runShellCommand({
      command: command.command,
      cwd: workspaceRoot,
      timeoutMs: command.timeoutMs,
    });
    setupResults.push({
      name: command.name ?? command.command,
      command: command.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      passed: result.exitCode === 0 && !result.timedOut,
      timedOut: result.timedOut,
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new Error(`Eval setup command failed for ${args.testCase.id}: ${command.command}`);
    }
  }

  await initializeGitBaseline(workspaceRoot, args.testCase.setup.commitMessage ?? `Initial eval fixture for ${args.testCase.id}`);

  const memorySource = join(args.repoRoot, '.heddle', 'auth.json');
  const memoryTarget = join(workspaceRoot, '.heddle', 'auth.json');
  if (existsSync(memorySource) && !existsSync(memoryTarget)) {
    mkdirSync(dirname(memoryTarget), { recursive: true });
    cpSync(memorySource, memoryTarget);
  }

  return { workspaceRoot, setupResults };
}

async function initializeGitBaseline(workspaceRoot: string, message: string) {
  await runRequiredGit(workspaceRoot, ['init']);
  await runRequiredGit(workspaceRoot, ['add', '.']);
  await runRequiredGit(workspaceRoot, [
    '-c',
    'user.name=Heddle Eval',
    '-c',
    'user.email=heddle-eval@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    message,
  ]);
}

async function runRequiredGit(cwd: string, args: string[]) {
  const result = await runCommand({ command: 'git', args, cwd, timeoutMs: 20_000 });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
}
