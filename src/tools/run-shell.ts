// ---------------------------------------------------------------------------
// Tools: run_shell_inspect / run_shell_mutate
// Safe by default — only allowlisted command prefixes are permitted.
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../types.js';

type RunShellInput = {
  command: string;
};

const DEFAULT_INSPECT_ALLOWLIST: string[] = [
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'rg',
  'find',
  'sed',
  'sort',
  'uniq',
  'jq',
  'echo',
  'pwd',
  'which',
  'file',
  'tree',
  'du',
  'df',
  'git log',
  'git diff',
  'git status',
  'git show',
  'git rev-parse',
  'git ls-files',
  'git grep',
  'git branch',
  'git tag',
  'git remote',
];

const DEFAULT_MUTATE_ALLOWLIST: string[] = [
  'yarn test',
  'yarn build',
  'yarn lint',
  'yarn format',
  'yarn prettier',
  'yarn eslint',
  'yarn vitest',
  'npx prettier --write',
  'npx eslint --fix',
  'prettier --write',
  'eslint --fix',
  'vitest',
  'tsc',
];

export type RunShellOptions = {
  allowlist?: string[];
};

type RunShellOutput = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function createRunShellInspectTool(options: RunShellOptions = {}): ToolDefinition {
  const allowlist = options.allowlist ?? DEFAULT_INSPECT_ALLOWLIST;

  return {
    name: 'run_shell_inspect',
    description:
      `Run a read-oriented shell command inside the current workspace. Use this for CLI-native inspection, search, diff, and git state checks when mature commands like rg, git, sed, or ls are a better fit than bespoke file tools. Returns structured output with command, exitCode, stdout, and stderr. For safety, only the following command prefixes are allowed: ${allowlist.join(', ')}. The command must start with one of these prefixes and may not use shell control operators like pipes, redirects, or command chaining.`,
    parameters: buildParameters(),
    execute: (raw) => executeRunShell(raw, {
      toolName: 'run_shell_inspect',
      allowlist,
    }),
  };
}

export function createRunShellMutateTool(options: RunShellOptions = {}): ToolDefinition {
  const allowlist = options.allowlist ?? DEFAULT_MUTATE_ALLOWLIST;

  return {
    name: 'run_shell_mutate',
    requiresApproval: true,
    description:
      `Run a bounded workspace mutation or verification command inside the current workspace. Use this only when inspection is not enough and you need formatting, test execution, type-checking, or another explicit workspace action. Returns structured output with command, exitCode, stdout, and stderr. For safety, only the following command prefixes are allowed: ${allowlist.join(', ')}. The command must start with one of these prefixes and may not use shell control operators like pipes, redirects, or command chaining.`,
    parameters: buildParameters(),
    execute: (raw) => executeRunShell(raw, {
      toolName: 'run_shell_mutate',
      allowlist,
    }),
  };
}

/**
 * Backward-compatible alias for the legacy single shell tool name.
 * Prefer createRunShellInspectTool / createRunShellMutateTool for new callers.
 */
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

function executeRunShell(
  raw: unknown,
  options: {
    toolName: string;
    allowlist: string[];
  },
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

  const isAllowed = options.allowlist.some((prefix) => cmd.startsWith(prefix));
  if (!isAllowed) {
    return Promise.resolve({
      ok: false,
      error: `Command not allowed. The command must start with one of: ${options.allowlist.join(', ')}`,
    });
  }

  try {
    const result = spawnSync(cmd, {
      shell: true,
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });

    if (result.error) {
      return Promise.resolve({
        ok: false,
        error: `Shell command failed: ${result.error.message}`,
      });
    }

    const output: RunShellOutput = {
      command: cmd,
      exitCode: result.status ?? 0,
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
    };

    if ((result.status ?? 0) !== 0) {
      return Promise.resolve({
        ok: false,
        error: `Shell command failed with exit code ${output.exitCode}`,
        output,
      });
    }

    return Promise.resolve({ ok: true, output });
  } catch (err) {
    return Promise.resolve({
      ok: false,
      error: `Shell command failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
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
