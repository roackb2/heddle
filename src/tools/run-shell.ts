// ---------------------------------------------------------------------------
// Tool: run_shell
// Safe by default — only allowlisted command prefixes are permitted.
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../types.js';

type RunShellInput = {
  command: string;
};

/**
 * Default allowlist of safe, read-oriented command prefixes.
 */
const DEFAULT_ALLOWLIST: string[] = [
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

export type RunShellOptions = {
  allowlist?: string[];
};

export function createRunShellTool(options: RunShellOptions = {}): ToolDefinition {
  const allowlist = options.allowlist ?? DEFAULT_ALLOWLIST;

  return {
    name: 'run_shell',
    description:
      `Run a read-oriented shell command inside the current workspace. Prefer this when mature CLI tools like rg, git, sed, or ls are a better fit than bespoke file tools. For safety, only the following command prefixes are allowed: ${allowlist.join(', ')}. The command must start with one of these prefixes and may not use shell control operators like pipes, redirects, or command chaining.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
      },
      required: ['command'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isRunShellInput(raw)) {
        return { ok: false, error: 'Invalid input for run_shell. Required field: command.' };
      }

      const input: RunShellInput = raw;
      const cmd = input.command.trim();

      if (containsShellControlOperators(cmd)) {
        return {
          ok: false,
          error: 'Command not allowed. Shell control operators such as pipes, redirects, command chaining, or subshells are blocked.',
        };
      }

      const isAllowed = allowlist.some((prefix) => cmd.startsWith(prefix));
      if (!isAllowed) {
        return {
          ok: false,
          error: `Command not allowed. The command must start with one of: ${allowlist.join(', ')}`,
        };
      }

      try {
        const output = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
        return { ok: true, output: output.trim() };
      } catch (err) {
        return {
          ok: false,
          error: `Shell command failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
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
