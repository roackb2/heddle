import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runShellCommand, DEFAULT_INSPECT_RULES, DEFAULT_MUTATE_RULES } from '../../../core/tools/toolkits/shell-process/run-shell.js';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

function createFakeChildProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  (child as any).stdout = stdout;
  (child as any).stderr = stderr;
  (child as any).kill = vi.fn(() => {
    (child as any).killed = true;
  });
  (child as any).killed = false;
  return { child, stdout, stderr };
}

describe('runShellCommand', () => {
  beforeEach(() => {
    const { child } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it('rejects invalid input', async () => {
    const result = await runShellCommand(undefined, {
      toolName: 'run_shell_inspect',
      rules: DEFAULT_INSPECT_RULES,
      allowUnknown: false,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for run_shell_inspect. Required field: command.',
    });
  });

  it('rejects commands containing blocked inspect shell control operators', async () => {
    const controlCommand = 'ls && echo hi';
    const result = await runShellCommand(
      { command: controlCommand },
      {
        toolName: 'run_shell_inspect',
        rules: DEFAULT_INSPECT_RULES,
        allowUnknown: false,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/read-only pipes|Shell control operators|command chaining/);
  });

  it('allows mutate shell control syntax because mutate is approval-gated', async () => {
    const { child, stdout } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const execution = runShellCommand(
      { command: 'echo ok && echo done' },
      {
        toolName: 'run_shell_mutate',
        rules: DEFAULT_MUTATE_RULES,
        allowUnknown: true,
      },
    );

    stdout.emit('data', 'ok\ndone\n');
    child.emit('close', 0);

    const result = await execution;
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      exitCode: 0,
      policy: {
        binary: 'echo',
        scope: 'workspace',
        risk: 'unknown',
      },
    });
  });

  it('allows heredoc-style mutate commands because mutate is approval-gated', async () => {
    const { child, stdout } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const execution = runShellCommand(
      { command: "python - <<'PY'\nprint('ok')\nPY" },
      {
        toolName: 'run_shell_mutate',
        rules: DEFAULT_MUTATE_RULES,
        allowUnknown: true,
      },
    );

    stdout.emit('data', 'ok\n');
    child.emit('close', 0);

    const result = await execution;
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      exitCode: 0,
      policy: {
        binary: 'python',
        scope: 'workspace',
        risk: 'unknown',
      },
    });
  });

  it('rejects commands that violate the inspect policy', async () => {
    const result = await runShellCommand(
      { command: 'foo' },
      {
        toolName: 'run_shell_inspect',
        rules: DEFAULT_INSPECT_RULES,
        allowUnknown: false,
      },
    );

    expect(result).toEqual({
      ok: false,
      error:
        'Command not allowed by run_shell_inspect policy. This tool only permits bounded read-oriented commands that match its configured workspace risk/scope rules. If the command is still needed, retry with run_shell_mutate.',
    });
  });

  it('runs unknown commands when allowUnknown is true and surfaces approval metadata', async () => {
    const { child, stdout } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const execution = runShellCommand(
      { command: 'foo' },
      {
        toolName: 'run_shell_mutate',
        rules: DEFAULT_MUTATE_RULES,
        allowUnknown: true,
      },
    );

    stdout.emit('data', 'ok\n');
    child.emit('close', 0);

    const result = await execution;
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'foo',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      policy: {
        binary: 'foo',
        scope: 'workspace',
        risk: 'unknown',
        reason: 'unclassified workspace command requiring explicit approval',
      },
    });
  });

  it('blocks catastrophically destructive mutate commands even in approval-gated mode', async () => {
    const result = await runShellCommand(
      { command: 'rm -rf ~/' },
      {
        toolName: 'run_shell_mutate',
        rules: DEFAULT_MUTATE_RULES,
        allowUnknown: true,
      },
    );

    expect(result).toEqual({
      ok: false,
      error:
        'Command not allowed. This command appears catastrophically destructive (home/root/disk-level) and is blocked even in approval-gated mutate mode.',
    });
  });

  it('reports failure for non-zero exit codes', async () => {
    const { child, stderr } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const execution = runShellCommand(
      { command: 'git status' },
      {
        toolName: 'run_shell_inspect',
        rules: DEFAULT_INSPECT_RULES,
        allowUnknown: false,
      },
    );

    stderr.emit('data', 'error\n');
    child.emit('close', 1);

    const result = await execution;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Shell command failed with exit code 1');
    expect(result.output).toMatchObject({
      exitCode: 1,
    });
  });

  it('returns an abort error when the host aborts the signal', async () => {
    const { child } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const controller = new AbortController();
    const execution = runShellCommand(
      { command: 'git rev-parse HEAD' },
      {
        toolName: 'run_shell_inspect',
        rules: DEFAULT_INSPECT_RULES,
        allowUnknown: false,
      },
      controller.signal,
    );

    controller.abort();
    child.emit('close', 0);

    const result = await execution;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Shell command aborted by host request');
  });

  it('times out after 30 seconds with a timeout error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const { child } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const execution = runShellCommand(
      { command: 'sleep 1' },
      {
        toolName: 'run_shell_mutate',
        rules: DEFAULT_MUTATE_RULES,
        allowUnknown: true,
      },
    );

    vi.advanceTimersByTime(30000);
    child.emit('close', 0);

    const result = await execution;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Shell command timed out after 30000ms');
  });
});
