import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CHILD_PATH = fileURLToPath(
  new URL('../../fixtures/tool-execution-natural-exit.ts', import.meta.url),
);

describe('tool execution process lifecycle', () => {
  it('lets a one-shot process exit naturally after a successful tool call', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', CHILD_PATH], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Child process remained alive after successful tool execution.'));
      }, 5_000);
    });

    const result = await Promise.race([exit, timeout]).finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });

    expect(result).toEqual({ code: 0, signal: null });
    expect(Buffer.concat(stdout).toString('utf8')).toBe('');
    expect(Buffer.concat(stderr).toString('utf8')).toBe('');
  }, 10_000);
});
