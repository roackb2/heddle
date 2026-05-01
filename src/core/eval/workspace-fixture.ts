import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runCommand, runShellCommand } from './process.js';
import type { EvalProgressReporter } from './progress.js';
import type { AgentEvalCase, EvalCheckResult, EvalRunResult } from './schema.js';

export type PreparedEvalWorkspace = {
  workspaceRoot: string;
  setupResults: EvalCheckResult[];
  fixture: EvalRunResult['fixture'];
};

export async function prepareEvalWorkspace(args: {
  testCase: AgentEvalCase;
  repoRoot: string;
  workRoot?: string;
  progress?: EvalProgressReporter;
}): Promise<PreparedEvalWorkspace> {
  const parent = args.workRoot ? resolve(args.workRoot) : mkdtempSync(join(tmpdir(), 'heddle-eval-'));
  mkdirSync(parent, { recursive: true });
  const workspaceRoot = join(parent, args.testCase.id);

  const fixture = args.testCase.fixture;
  if (fixture.type === 'inline') {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
  const prepared =
    fixture.type === 'git-worktree' ?
      await prepareGitWorktreeFixture({
        repoRoot: args.repoRoot,
        workspaceRoot,
        testCase: args.testCase,
        progress: args.progress,
      })
    : await prepareInlineFixture({
        workspaceRoot,
        testCase: args.testCase,
        progress: args.progress,
      });

  copyAuthState({
    repoRoot: args.repoRoot,
    workspaceRoot,
  });

  return prepared;
}

async function prepareInlineFixture(args: {
  workspaceRoot: string;
  testCase: AgentEvalCase;
  progress?: EvalProgressReporter;
}): Promise<PreparedEvalWorkspace> {
  mkdirSync(args.workspaceRoot, { recursive: true });
  const setupResults = await applyEvalSetup({
    workspaceRoot: args.workspaceRoot,
    testCase: args.testCase,
    progress: args.progress,
  });
  const baselineCommit = await trackProgress(args.progress, {
    phase: 'workspace.baseline',
    message: 'commit inline fixture baseline',
    run: () => initializeGitBaseline(
      args.workspaceRoot,
      args.testCase.setup.commitMessage ?? `Initial eval fixture for ${args.testCase.id}`,
    ),
  });

  return {
    workspaceRoot: args.workspaceRoot,
    setupResults,
    fixture: {
      type: 'inline',
      baselineCommit,
    },
  };
}

async function prepareGitWorktreeFixture(args: {
  repoRoot: string;
  workspaceRoot: string;
  testCase: AgentEvalCase;
  progress?: EvalProgressReporter;
}): Promise<PreparedEvalWorkspace> {
  const fixture = args.testCase.fixture;
  if (fixture.type !== 'git-worktree') {
    throw new Error(`Unsupported fixture type for git worktree setup: ${fixture.type}`);
  }

  const sourceRepo = resolve(args.repoRoot, fixture.repo);
  const resolvedRef = await trackProgress(args.progress, {
    phase: 'workspace.resolve-ref',
    message: `resolve target ref ${fixture.ref}`,
    run: () => resolveGitCommit(sourceRepo, fixture.ref),
  });
  await trackProgress(args.progress, {
    phase: 'workspace.cleanup',
    message: 'remove existing dogfood worktree if needed',
    run: () => removeGitWorktree(sourceRepo, args.workspaceRoot),
  });
  await trackProgress(args.progress, {
    phase: 'workspace.worktree',
    message: `create pinned worktree at ${fixture.ref}`,
    run: () => runRequiredGit(sourceRepo, ['worktree', 'add', '--detach', args.workspaceRoot, resolvedRef]),
  });

  const setupResults = await applyEvalSetup({
    workspaceRoot: args.workspaceRoot,
    testCase: args.testCase,
    progress: args.progress,
  });
  const baselineCommit =
    await hasGitChanges(args.workspaceRoot) ?
      await trackProgress(args.progress, {
        phase: 'workspace.baseline',
        message: 'commit seeded eval baseline',
        run: () => commitAll(args.workspaceRoot, args.testCase.setup.commitMessage ?? `Eval setup for ${args.testCase.id}`),
      })
    : resolvedRef;

  return {
    workspaceRoot: args.workspaceRoot,
    setupResults,
    fixture: {
      type: 'git-worktree',
      repo: sourceRepo,
      ref: fixture.ref,
      resolvedRef,
      baselineCommit,
    },
  };
}

async function applyEvalSetup(args: {
  workspaceRoot: string;
  testCase: AgentEvalCase;
  progress?: EvalProgressReporter;
}): Promise<EvalCheckResult[]> {
  for (const [relativePath, content] of Object.entries(args.testCase.setup.files ?? {})) {
    const path = join(args.workspaceRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }

  const setupResults: EvalCheckResult[] = [];
  for (const command of args.testCase.setup.commands ?? []) {
    const name = command.name ?? command.command;
    const result = await trackProgress(args.progress, {
      phase: 'workspace.setup-command',
      message: `run setup command: ${name}`,
      heartbeatMessage: `still running setup command: ${name}`,
      run: () => runShellCommand({
        command: command.command,
        cwd: args.workspaceRoot,
        timeoutMs: command.timeoutMs,
      }),
    });
    setupResults.push({
      name,
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
  return setupResults;
}

function copyAuthState(args: {
  repoRoot: string;
  workspaceRoot: string;
}) {
  const memorySource = join(args.repoRoot, '.heddle', 'auth.json');
  const memoryTarget = join(args.workspaceRoot, '.heddle', 'auth.json');
  if (existsSync(memorySource) && !existsSync(memoryTarget)) {
    mkdirSync(dirname(memoryTarget), { recursive: true });
    cpSync(memorySource, memoryTarget);
  }
}

async function trackProgress<T>(
  progress: EvalProgressReporter | undefined,
  args: {
    phase: string;
    message: string;
    heartbeatMessage?: string;
    heartbeatMs?: number;
    run: () => Promise<T>;
  },
): Promise<T> {
  return progress ? await progress.track(args) : await args.run();
}

async function initializeGitBaseline(workspaceRoot: string, message: string): Promise<string> {
  await runRequiredGit(workspaceRoot, ['init']);
  return await commitAll(workspaceRoot, message, true);
}

async function commitAll(workspaceRoot: string, message: string, allowEmpty = false): Promise<string> {
  await runRequiredGit(workspaceRoot, ['add', '.']);
  await runRequiredGit(workspaceRoot, [
    '-c',
    'user.name=Heddle Eval',
    '-c',
    'user.email=heddle-eval@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    ...(allowEmpty ? ['--allow-empty'] : []),
    '-m',
    message,
  ]);
  return await resolveGitCommit(workspaceRoot, 'HEAD');
}

async function resolveGitCommit(cwd: string, ref: string): Promise<string> {
  const result = await runCommand({
    command: 'git',
    args: ['rev-parse', '--verify', `${ref}^{commit}`],
    cwd,
    timeoutMs: 20_000,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(`git rev-parse failed for ${ref}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function hasGitChanges(workspaceRoot: string): Promise<boolean> {
  const result = await runCommand({
    command: 'git',
    args: ['status', '--porcelain'],
    cwd: workspaceRoot,
    timeoutMs: 20_000,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(`git status --porcelain failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim().length > 0;
}

async function removeGitWorktree(repoRoot: string, workspaceRoot: string) {
  if (!existsSync(workspaceRoot)) {
    return;
  }
  const result = await runCommand({
    command: 'git',
    args: ['worktree', 'remove', '--force', workspaceRoot],
    cwd: repoRoot,
    timeoutMs: 20_000,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    rmSync(workspaceRoot, { recursive: true, force: true });
    await runRequiredGit(repoRoot, ['worktree', 'prune']);
  }
}

async function runRequiredGit(cwd: string, args: string[]) {
  const result = await runCommand({ command: 'git', args, cwd, timeoutMs: 20_000 });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
}
