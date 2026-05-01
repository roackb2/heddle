import { spawn } from 'node:child_process';

export type CommandRunResult = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

export async function runCommand(args: {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<CommandRunResult> {
  const startedAt = Date.now();
  const argv = [args.command, ...(args.args ?? [])];
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(args.command, args.args ?? [], {
      cwd: args.cwd,
      env: args.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout =
      args.timeoutMs ?
        setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 2_000).unref();
        }, args.timeoutMs)
      : undefined;

    child.stdout?.on('data', (chunk) => {
      stdout += Buffer.from(chunk).toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += Buffer.from(chunk).toString('utf8');
    });

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({
        command: argv,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    };

    child.on('error', (error) => {
      stderr += `${error instanceof Error ? error.message : String(error)}\n`;
      finish(null);
    });
    child.on('exit', (code) => finish(code));
  });
}

export async function runShellCommand(args: {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<CommandRunResult> {
  return await runCommand({
    command: '/bin/sh',
    cwd: args.cwd,
    env: args.env,
    timeoutMs: args.timeoutMs,
    args: ['-lc', args.command],
  });
}
