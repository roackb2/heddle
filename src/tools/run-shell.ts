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
  'find',
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
      `Run a shell command. For safety, only the following command prefixes are allowed: ${allowlist.join(', ')}. The command must start with one of these prefixes.`,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
      },
      required: ['command'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      const input = raw as RunShellInput;
      const cmd = input.command.trim();

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
