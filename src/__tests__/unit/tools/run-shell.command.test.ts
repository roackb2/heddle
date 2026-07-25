import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRunShellInspectTool,
  createRunShellMutateTool,
  runShellCommand,
  DEFAULT_INSPECT_RULES,
  DEFAULT_MUTATE_RULES,
} from '../../../core/tools/toolkits/shell-process/run-shell.js';

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

  it('signals the spawned shell on timeout without supervising its descendants', async () => {
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

    // Current behavior: one SIGTERM to the shell itself. The follow-up SIGKILL
    // is guarded by child.killed, which Node sets once the signal is delivered,
    // so the escalation does not fire. Descendants are not signalled at all.
    // Locked deliberately -- see docs/architecture/execution-boundaries.md.
    expect((child as any).kill).toHaveBeenCalledTimes(1);
    expect((child as any).kill).toHaveBeenCalledWith('SIGTERM');

    vi.advanceTimersByTime(1000);
    expect((child as any).kill).toHaveBeenCalledTimes(1);

    child.emit('close', 0);
    await execution;
  });

  it('caps each output stream at 1 MiB and retains the tail without a truncation marker', async () => {
    const { child, stdout, stderr } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const execution = runShellCommand(
      { command: 'git log' },
      {
        toolName: 'run_shell_inspect',
        rules: DEFAULT_INSPECT_RULES,
        allowUnknown: false,
      },
    );

    const limit = 1024 * 1024;
    stdout.emit('data', 'a'.repeat(limit));
    stdout.emit('data', `${'b'.repeat(limit - 1)}z`);
    stderr.emit('data', 'e'.repeat(limit + 10));
    child.emit('close', 0);

    const result = await execution;
    const output = result.output as { stdout: string; stderr: string };

    // The head is discarded silently: the model cannot distinguish truncated
    // output from complete output.
    expect(output.stdout.length).toBe(limit);
    expect(output.stdout.startsWith('a')).toBe(false);
    expect(output.stdout.endsWith('z')).toBe(true);
    expect(output.stderr.length).toBe(limit);
  });

  it('does not confine a command to the workspace root', async () => {
    const { child, stdout } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const execution = runShellCommand(
      { command: 'cat /etc/hosts' },
      {
        toolName: 'run_shell_mutate',
        rules: DEFAULT_MUTATE_RULES,
        allowUnknown: true,
        cwd: '/workspace/project',
      },
    );

    stdout.emit('data', 'contents\n');
    child.emit('close', 0);

    const result = await execution;

    // The workspace is the initial working directory, not a boundary. An
    // absolute path outside it is neither rejected nor rewritten. Approval is
    // the only gate on this command.
    expect(result.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith('cat /etc/hosts', {
      cwd: '/workspace/project',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });
});

describe('run shell tool definitions', () => {
  beforeEach(() => {
    const { child } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('gates only the mutate tool behind approval', () => {
    expect(createRunShellInspectTool().requiresApproval).toBeFalsy();
    expect(createRunShellMutateTool().requiresApproval).toBe(true);
  });

  it('describes the workspace as an initial directory rather than a boundary', () => {
    for (const tool of [createRunShellInspectTool(), createRunShellMutateTool()]) {
      expect(tool.description).toContain('not an enforced boundary');
      expect(tool.description).toContain("host user's full authority");
      expect(tool.description).not.toMatch(/inside the current workspace/);
    }
  });
});
