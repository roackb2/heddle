// ---------------------------------------------------------------------------
// Tools: run_shell_inspect / run_shell_mutate
// Policy-based shell execution with explicit scope/risk metadata.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../types.js';

type RunShellInput = {
  command: string;
};

export type RunShellScope = 'inspect' | 'workspace';
export type RunShellRisk = 'low' | 'medium' | 'unknown';

export type RunShellPolicyDecision = {
  binary: string;
  scope: RunShellScope;
  risk: RunShellRisk;
  reason: string;
};

type RunShellRule = {
  binary: string;
  argsPrefix?: string[];
  scope: RunShellScope;
  risk: RunShellRisk;
  reason: string;
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
};

export const DEFAULT_INSPECT_RULES: RunShellRule[] = [
  inspectRule('ls', 'workspace listing'),
  inspectRule('cat', 'file inspection'),
  inspectRule('head', 'file inspection'),
  inspectRule('tail', 'file inspection'),
  inspectRule('wc', 'workspace inspection'),
  inspectRule('grep', 'workspace inspection'),
  inspectRule('rg', 'workspace inspection'),
  inspectRule('find', 'workspace inspection'),
  inspectRule('sed', 'workspace inspection'),
  inspectRule('sort', 'workspace inspection'),
  inspectRule('uniq', 'workspace inspection'),
  inspectRule('jq', 'structured output inspection'),
  inspectRule('echo', 'simple shell inspection'),
  inspectRule('pwd', 'workspace location check'),
  inspectRule('which', 'binary discovery'),
  inspectRule('file', 'file metadata inspection'),
  inspectRule('tree', 'workspace tree inspection'),
  inspectRule('du', 'workspace disk inspection'),
  inspectRule('df', 'filesystem inspection'),
  inspectRule('git', 'git history inspection', ['log']),
  inspectRule('git', 'git diff inspection', ['diff']),
  inspectRule('git', 'git status inspection', ['status']),
  inspectRule('git', 'git object inspection', ['show']),
  inspectRule('git', 'git revision inspection', ['rev-parse']),
  inspectRule('git', 'git file inventory inspection', ['ls-files']),
  inspectRule('git', 'git content search inspection', ['grep']),
  inspectRule('git', 'git branch inspection', ['branch']),
  inspectRule('git', 'git tag inspection', ['tag']),
  inspectRule('git', 'git remote inspection', ['remote']),
];

export const DEFAULT_MUTATE_RULES: RunShellRule[] = [
  workspaceRule('yarn', 'medium', 'workspace dependency install command', ['add']),
  workspaceRule('yarn', 'medium', 'workspace dependency install command', ['install']),
  workspaceRule('yarn', 'medium', 'workspace dependency removal command', ['remove']),
  workspaceRule('yarn', 'low', 'workspace verification command', ['test']),
  workspaceRule('yarn', 'low', 'workspace verification command', ['build']),
  workspaceRule('yarn', 'low', 'workspace verification command', ['lint']),
  workspaceRule('yarn', 'low', 'workspace verification command', ['vitest']),
  workspaceRule('vitest', 'low', 'workspace verification command'),
  workspaceRule('tsc', 'low', 'workspace verification command'),
  workspaceRule('yarn', 'medium', 'workspace formatting command', ['format']),
  workspaceRule('yarn', 'medium', 'workspace formatting command', ['prettier']),
  workspaceRule('yarn', 'medium', 'workspace formatting command', ['eslint']),
  workspaceRule('npx', 'medium', 'workspace formatting command', ['prettier', '--write']),
  workspaceRule('npx', 'medium', 'workspace formatting command', ['eslint', '--fix']),
  workspaceRule('prettier', 'medium', 'workspace formatting command', ['--write']),
  workspaceRule('eslint', 'medium', 'workspace formatting command', ['--fix']),
  workspaceRule('mkdir', 'medium', 'workspace file operation'),
  workspaceRule('touch', 'medium', 'workspace file operation'),
  workspaceRule('mv', 'medium', 'workspace file operation'),
  workspaceRule('cp', 'medium', 'workspace file operation'),
  workspaceRule('git', 'medium', 'git staging operation', ['add']),
  workspaceRule('git', 'medium', 'git file move operation', ['mv']),
];

export function createRunShellInspectTool(options: RunShellOptions = {}): ToolDefinition {
  const rules = options.rules ?? DEFAULT_INSPECT_RULES;

  return {
    name: 'run_shell_inspect',
    description:
      `Run a read-oriented shell command inside the current workspace. Use this for CLI-native inspection, search, diff, and git state checks when mature commands like rg, git, sed, or ls are a better fit than bespoke file tools. Returns structured output with command, exitCode, stdout, stderr, and policy metadata. This tool is governed by low-risk inspect rules, not arbitrary shell access. Shell control operators like pipes, redirects, chaining, and subshells are blocked.`,
    parameters: buildParameters(),
    execute: (raw) => runShellCommand(raw, {
      toolName: 'run_shell_inspect',
      rules,
      allowUnknown: false,
    }),
  };
}

export function createRunShellMutateTool(options: RunShellOptions = {}): ToolDefinition {
  const rules = options.rules ?? DEFAULT_MUTATE_RULES;

  return {
    name: 'run_shell_mutate',
    requiresApproval: true,
    description:
      `Run a bounded workspace execution command inside the current workspace. Use this only when inspection is not enough and you need verification, formatting, staging, or another explicit workspace action. Returns structured output with command, exitCode, stdout, stderr, and policy metadata. This tool is governed by host-side workspace execution rules with explicit risk classification rather than open-ended shell access. Shell control operators like pipes, redirects, chaining, and subshells are blocked.`,
    parameters: buildParameters(),
    execute: (raw) => runShellCommand(raw, {
      toolName: 'run_shell_mutate',
      rules,
      allowUnknown: true,
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

  if (containsShellControlOperators(cmd)) {
    return Promise.resolve({
      ok: false,
      error: 'Command not allowed. Shell control operators such as pipes, redirects, command chaining, or subshells are blocked.',
    });
  }

  const argv = tokenizeCommand(cmd);
  if (argv.length === 0) {
    return Promise.resolve({
      ok: false,
      error: 'Command not allowed. The command must not be empty.',
    });
  }

  const policy = classifyCommand(argv, options.rules, options.allowUnknown);
  if (!policy) {
    return Promise.resolve({
      ok: false,
      error: `Command not allowed by ${options.toolName} policy. This tool only permits bounded commands that match its configured workspace risk/scope rules.`,
    });
  }

  return new Promise<ToolResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const child = spawn(cmd, {
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

function classifyCommand(
  argv: string[],
  rules: RunShellRule[],
  allowUnknown: boolean,
): RunShellPolicyDecision | undefined {
  const binary = argv[0] ?? '';
  const args = argv.slice(1);
  const rule = rules.find((candidate) => {
    if (candidate.binary !== binary) {
      return false;
    }

    if (!candidate.argsPrefix || candidate.argsPrefix.length === 0) {
      return true;
    }

    return candidate.argsPrefix.every((part, index) => args[index] === part);
  });

  if (!rule) {
    return allowUnknown ?
        {
          binary,
          scope: 'workspace',
          risk: 'unknown',
          reason: 'unclassified workspace command requiring explicit approval',
        }
      : undefined;
  }

  return {
    binary: rule.binary,
    scope: rule.scope,
    risk: rule.risk,
    reason: rule.reason,
  };
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

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'command') {
    return false;
  }

  return typeof input.command === 'string';
}

function containsShellControlOperators(command: string): boolean {
  return /[|;&><`]/.test(command) || command.includes('&&') || command.includes('||') || command.includes('$(');
}

function inspectRule(binary: string, reason: string, argsPrefix?: string[]): RunShellRule {
  return {
    binary,
    argsPrefix,
    scope: 'inspect',
    risk: 'low',
    reason,
  };
}

function workspaceRule(
  binary: string,
  risk: RunShellRisk,
  reason: string,
  argsPrefix?: string[],
): RunShellRule {
  return {
    binary,
    argsPrefix,
    scope: 'workspace',
    risk,
    reason,
  };
}
