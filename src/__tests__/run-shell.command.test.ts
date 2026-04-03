import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runShellCommand, DEFAULT_INSPECT_RULES, DEFAULT_MUTATE_RULES } from '../tools/run-shell.js';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

function createFakeChildProcess() {
  const stdout = new EventEmitter() as ChildProcessWithoutNullStreams['stdout'];
  const stderr = new EventEmitter() as ChildProcessWithoutNullStreams['stderr'];
  const child = new EventEmitter() as ChildProcessWithoutNullStreams & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: string) => boolean;
    killed?: boolean;
  };

  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  child.killed = false;

  return { child, stdout, stderr };
}

describe('runShellCommand helper', () => {
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

  it('rejects commands that contain control operators', async () => {
    const result = await runShellCommand(
      { command: 'ls && echo hi' },
      { toolName: 'run_shell_inspect', rules: DEFAULT_INSPECT_RULES, allowUnknown: false },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/command chaining|Shell control operators/);
  });

  it('rejects commands that violate the inspect policy when allowUnknown is false', async () => {
    const result = await runShellCommand(
      { command: 'unlisted-command' },
      { toolName: 'run_shell_inspect', rules: DEFAULT_INSPECT_RULES, allowUnknown: false },
    );

    expect(result).toEqual({
      ok: false,
      error: 'Command not allowed by run_shell_inspect policy. This tool only permits bounded commands that match its configured workspace risk/scope rules.',
    });
  });

  it('allows unknown commands when allowUnknown is true and returns unknown policy metadata', async () => {
    const { child, stdout } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runShellCommand(
      { command: 'unlisted-command' },
      {
        toolName: 'run_shell_mutate',
        rules: DEFAULT_MUTATE_RULES,
        allowUnknown: true,
      },
    );

    stdout.emit('data', 'ok\n');
    child.emit('close', 0);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'unlisted-command',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      policy: {
        binary: 'unlisted-command',
        scope: 'workspace',
        risk: 'unknown',
        reason: 'unclassified workspace command requiring explicit approval',
      },
    });
  });

  it('reports failure when the command exits with non-zero status', async () => {
    const { child, stderr } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runShellCommand(
      { command: 'git status' },
      {
        toolName: 'run_shell_inspect',
        rules: DEFAULT_INSPECT_RULES,
        allowUnknown: false,
      },
    );

    stderr.emit('data', 'fatal\n');
    child.emit('close', 1);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Shell command failed with exit code 1');
    expect(result.output).toMatchObject({
      exitCode: 1,
    });
  });

  it('returns an abort error when the signal is triggered', async () => {
    const { child } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const controller = new AbortController();
    const promise = runShellCommand(
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

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Shell command aborted by host request');
  });

  it('times out after 30 seconds and reports the timeout error', async () => {
    vi.useFakeTimers();
    const { child } = createFakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runShellCommand(
      { command: 'sleep 1' },
      {
        toolName: 'run_shell_mutate',
        rules: DEFAULT_MUTATE_RULES,
        allowUnknown: true,
      },
    );

    vi.advanceTimersByTime(30000);
    child.emit('close', 0);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Shell command timed out after 30000ms');
  });
});
