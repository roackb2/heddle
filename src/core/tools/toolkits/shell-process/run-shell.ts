// ---------------------------------------------------------------------------
// Tools: run_shell_inspect / run_shell_mutate
// Policy-based shell execution with explicit scope/risk metadata.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../../../types.js';
import {
  classifyShellCommandPolicy,
  containsBlockedShellControlOperators,
  DEFAULT_INSPECT_RULES,
  DEFAULT_MUTATE_RULES,
  getCatastrophicCommandError,
  type RunShellPolicyDecision,
  type RunShellRule,
} from './shell-policy.js';

type RunShellInput = {
  command: string;
};

type RunShellOutput = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  policy: RunShellPolicyDecision;
};

export type RunShellOptions = {
  rules?: RunShellRule[];
  cwd?: string;
};

export { classifyShellCommandPolicy, DEFAULT_INSPECT_RULES, DEFAULT_MUTATE_RULES } from './shell-policy.js';
export type {
  RunShellCapability,
  RunShellPolicyDecision,
  RunShellRisk,
  RunShellRule,
  RunShellScope,
} from './shell-policy.js';

export function createRunShellInspectTool(options: RunShellOptions = {}): ToolDefinition {
  const rules = options.rules ?? DEFAULT_INSPECT_RULES;

  return {
    name: 'run_shell_inspect',
    description:
      `Run a bounded read-oriented shell command inside the current workspace. Use this for CLI-native inspection, search, diff, and git state checks when mature commands like rg, git, sed, or ls are a better fit than bespoke file tools. Returns structured output with command, exitCode, stdout, stderr, and policy metadata. This tool is governed by low-risk inspect rules, not arbitrary shell access. Use this when the command is clearly read-oriented and likely to fit the inspect policy. If inspect rejects a command because it is arbitrary, uses inline scripts, or needs broader shell expressiveness, retry with run_shell_mutate instead of concluding the command cannot be run. Read-only pipelines with | are allowed for inspection commands, but redirects, command chaining, and subshells are blocked.`,
    parameters: buildParameters(),
    execute: (raw: unknown) => runShellCommand(raw, {
      toolName: 'run_shell_inspect',
      rules,
      allowUnknown: false,
      cwd: options.cwd,
    }),
  };
}

export function createRunShellMutateTool(options: RunShellOptions = {}): ToolDefinition {
  const rules = options.rules ?? DEFAULT_MUTATE_RULES;

  return {
    name: 'run_shell_mutate',
    requiresApproval: true,
    description:
      `Run an approval-gated shell command inside the current workspace. Use this when inspection is not enough, when the command is arbitrary or unclassified, when you need inline scripts or broader shell expressiveness, or when run_shell_inspect rejects a still-necessary command. Returns structured output with command, exitCode, stdout, stderr, and policy metadata. This tool is governed by host-side execution rules with explicit risk classification and approval instead of a narrow command allowlist. Arbitrary commands are allowed here through approval; do not assume a command is impossible just because inspect refused it.`,
    parameters: buildParameters(),
    execute: (raw: unknown) => runShellCommand(raw, {
      toolName: 'run_shell_mutate',
      rules,
      allowUnknown: true,
      cwd: options.cwd,
    }),
  };
}

export function createRunShellTool(options: RunShellOptions = {}): ToolDefinition {
  return createRunShellInspectTool(options);
}

function buildParameters(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
    },
    required: ['command'],
  };
}

export function runShellCommand(
  raw: unknown,
  options: {
    toolName: string;
    rules: RunShellRule[];
    allowUnknown: boolean;
    cwd?: string;
  },
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (!isRunShellInput(raw)) {
    return Promise.resolve({
      ok: false,
      error: `Invalid input for ${options.toolName}. Required field: command.`,
    });
  }

  const cmd = raw.command.trim();

  const mutateCatastrophicError = getCatastrophicCommandError(cmd, options.toolName);
  if (mutateCatastrophicError) {
    return Promise.resolve({
      ok: false,
      error: mutateCatastrophicError,
    });
  }

  if (containsBlockedShellControlOperators(cmd, options.toolName)) {
    return Promise.resolve({
      ok: false,
      error:
        'Command not allowed. Inspect mode permits read-only pipes, but redirects, command chaining, backgrounding, and subshells are blocked. If the command is still needed, retry with run_shell_mutate.',
    });
  }

  const argv = tokenizeCommand(cmd);
  if (argv.length === 0) {
    return Promise.resolve({
      ok: false,
      error: 'Command not allowed. The command must not be empty.',
    });
  }

  const policy = classifyShellCommandPolicy(cmd, {
    toolName: options.toolName,
    rules: options.rules,
    allowUnknown: options.allowUnknown,
  });
  if ('error' in policy) {
    return Promise.resolve({
      ok: false,
      error:
        options.toolName === 'run_shell_inspect' ?
          `Command not allowed by ${options.toolName} policy. This tool only permits bounded read-oriented commands that match its configured workspace risk/scope rules. If the command is still needed, retry with run_shell_mutate.`
        : `Command not allowed by ${options.toolName} policy. This tool only permits bounded commands that match its configured workspace risk/scope rules.`,
    });
  }

  return new Promise<ToolResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const child = spawn(cmd, {
      cwd: options.cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const finish = (result: ToolResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 500).unref();
    };

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 500).unref();
    }, 30_000);

    if (signal?.aborted) {
      onAbort();
    } else if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 1024 * 1024) {
        stdout = stdout.slice(-1024 * 1024);
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 1024 * 1024) {
        stderr = stderr.slice(-1024 * 1024);
      }
    });

    child.on('error', (error) => {
      finish({
        ok: false,
        error: `Shell command failed: ${error.message}`,
      });
    });

    child.on('close', (code) => {
      const output: RunShellOutput = {
        command: cmd,
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        policy,
      };

      if (aborted) {
        finish({
          ok: false,
          error: 'Shell command aborted by host request',
          output,
        });
        return;
      }

      if (timedOut) {
        finish({
          ok: false,
          error: 'Shell command timed out after 30000ms',
          output,
        });
        return;
      }

      if ((code ?? 0) !== 0) {
        finish({
          ok: false,
          error: `Shell command failed with exit code ${output.exitCode}`,
          output,
        });
        return;
      }

      finish({ ok: true, output });
    });
  });
}

function tokenizeCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isRunShellInput(raw: unknown): raw is RunShellInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as { command?: unknown };
  return typeof input.command === 'string';
}
