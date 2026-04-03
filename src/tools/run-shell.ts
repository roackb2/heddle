// ---------------------------------------------------------------------------
// Tools: run_shell_inspect / run_shell_mutate
// Policy-based shell execution with explicit scope/risk metadata.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../types.js';

type RunShellInput = {
  command: string;
};

export type RunShellScope = 'inspect' | 'workspace' | 'external';
export type RunShellRisk = 'low' | 'medium' | 'unknown';
export type RunShellCapability =
  | 'workspace_listing'
  | 'file_inspection'
  | 'workspace_search'
  | 'structured_inspection'
  | 'environment_inspection'
  | 'git_inspection'
  | 'dependency'
  | 'verification'
  | 'formatting'
  | 'file_operation'
  | 'git_staging'
  | 'project_script'
  | 'unknown_workspace';

export type RunShellPolicyDecision = {
  binary: string;
  scope: RunShellScope;
  risk: RunShellRisk;
  capability: RunShellCapability;
  reason: string;
};

type RunShellRule = {
  binary: string;
  argsPrefix?: string[];
  scope: RunShellScope;
  risk: RunShellRisk;
  capability: RunShellCapability;
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
  inspectRule('ls', 'workspace_listing', 'workspace listing'),
  inspectRule('nl', 'file_inspection', 'numbered file inspection'),
  inspectRule('cat', 'file_inspection', 'file inspection'),
  inspectRule('head', 'file_inspection', 'file inspection'),
  inspectRule('tail', 'file_inspection', 'file inspection'),
  inspectRule('wc', 'file_inspection', 'workspace inspection'),
  inspectRule('grep', 'workspace_search', 'workspace inspection'),
  inspectRule('rg', 'workspace_search', 'workspace inspection'),
  inspectRule('find', 'workspace_search', 'workspace inspection'),
  inspectRule('sed', 'file_inspection', 'workspace inspection'),
  inspectRule('sort', 'structured_inspection', 'workspace inspection'),
  inspectRule('uniq', 'structured_inspection', 'workspace inspection'),
  inspectRule('jq', 'structured_inspection', 'structured output inspection'),
  inspectRule('echo', 'environment_inspection', 'simple shell inspection'),
  inspectRule('pwd', 'environment_inspection', 'workspace location check'),
  inspectRule('which', 'environment_inspection', 'binary discovery'),
  inspectRule('file', 'file_inspection', 'file metadata inspection'),
  inspectRule('tree', 'workspace_listing', 'workspace tree inspection'),
  inspectRule('du', 'environment_inspection', 'workspace disk inspection'),
  inspectRule('df', 'environment_inspection', 'filesystem inspection'),
  inspectRule('git', 'git_inspection', 'git history inspection', ['log']),
  inspectRule('git', 'git_inspection', 'git diff inspection', ['diff']),
  inspectRule('git', 'git_inspection', 'git status inspection', ['status']),
  inspectRule('git', 'git_inspection', 'git object inspection', ['show']),
  inspectRule('git', 'git_inspection', 'git revision inspection', ['rev-parse']),
  inspectRule('git', 'git_inspection', 'git file inventory inspection', ['ls-files']),
  inspectRule('git', 'git_inspection', 'git content search inspection', ['grep']),
  inspectRule('git', 'git_inspection', 'git branch inspection', ['branch']),
  inspectRule('git', 'git_inspection', 'git tag inspection', ['tag']),
  inspectRule('git', 'git_inspection', 'git remote inspection', ['remote']),
];

export const DEFAULT_MUTATE_RULES: RunShellRule[] = [
  workspaceRule('yarn', 'medium', 'dependency', 'workspace dependency install command', ['add']),
  workspaceRule('yarn', 'medium', 'dependency', 'workspace dependency install command', ['install']),
  workspaceRule('yarn', 'medium', 'dependency', 'workspace dependency removal command', ['remove']),
  workspaceRule('yarn', 'low', 'verification', 'workspace verification command', ['test']),
  workspaceRule('yarn', 'low', 'verification', 'workspace verification command', ['build']),
  workspaceRule('yarn', 'low', 'verification', 'workspace verification command', ['lint']),
  workspaceRule('yarn', 'low', 'verification', 'workspace verification command', ['vitest']),
  workspaceRule('vitest', 'low', 'verification', 'workspace verification command'),
  workspaceRule('tsc', 'low', 'verification', 'workspace verification command'),
  workspaceRule('yarn', 'medium', 'project_script', 'workspace project script command', ['run']),
  workspaceRule('yarn', 'medium', 'formatting', 'workspace formatting command', ['format']),
  workspaceRule('yarn', 'medium', 'formatting', 'workspace formatting command', ['prettier']),
  workspaceRule('yarn', 'medium', 'formatting', 'workspace formatting command', ['eslint']),
  workspaceRule('npx', 'medium', 'formatting', 'workspace formatting command', ['prettier', '--write']),
  workspaceRule('npx', 'medium', 'formatting', 'workspace formatting command', ['eslint', '--fix']),
  workspaceRule('prettier', 'medium', 'formatting', 'workspace formatting command', ['--write']),
  workspaceRule('eslint', 'medium', 'formatting', 'workspace formatting command', ['--fix']),
  workspaceRule('mkdir', 'medium', 'file_operation', 'workspace file operation'),
  workspaceRule('touch', 'medium', 'file_operation', 'workspace file operation'),
  workspaceRule('mv', 'medium', 'file_operation', 'workspace file operation'),
  workspaceRule('cp', 'medium', 'file_operation', 'workspace file operation'),
  workspaceRule('git', 'medium', 'git_staging', 'git staging operation', ['add']),
  workspaceRule('git', 'medium', 'file_operation', 'git file move operation', ['mv']),
];

export function createRunShellInspectTool(options: RunShellOptions = {}): ToolDefinition {
  const rules = options.rules ?? DEFAULT_INSPECT_RULES;

  return {
    name: 'run_shell_inspect',
    description:
      `Run a bounded read-oriented shell command inside the current workspace. Use this for CLI-native inspection, search, diff, and git state checks when mature commands like rg, git, sed, or ls are a better fit than bespoke file tools. Returns structured output with command, exitCode, stdout, stderr, and policy metadata. This tool is governed by low-risk inspect rules, not arbitrary shell access. Use this when the command is clearly read-oriented and likely to fit the inspect policy. If inspect rejects a command because it is arbitrary, uses inline scripts, or needs broader shell expressiveness, retry with run_shell_mutate instead of concluding the command cannot be run. Read-only pipelines with | are allowed for inspection commands, but redirects, command chaining, and subshells are blocked.`,
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
      `Run an approval-gated shell command inside the current workspace. Use this when inspection is not enough, when the command is arbitrary or unclassified, when you need inline scripts or broader shell expressiveness, or when run_shell_inspect rejects a still-necessary command. Returns structured output with command, exitCode, stdout, stderr, and policy metadata. This tool is governed by host-side execution rules with explicit risk classification and approval instead of a narrow command allowlist. Arbitrary commands are allowed here through approval; do not assume a command is impossible just because inspect refused it.`,
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

  const policy = classifyCommand(argv, options.rules, options.allowUnknown);
  if (!policy) {
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

export function classifyShellCommandPolicy(
  command: string,
  options: {
    toolName: string;
    rules: RunShellRule[];
    allowUnknown: boolean;
  },
): RunShellPolicyDecision | { error: string } {
  const normalized = command.trim();
  if (!normalized) {
    return { error: 'Command not allowed. The command must not be empty.' };
  }

  const mutateCatastrophicError = getCatastrophicCommandError(normalized, options.toolName);
  if (mutateCatastrophicError) {
    return { error: mutateCatastrophicError };
  }

  if (containsBlockedShellControlOperators(normalized, options.toolName)) {
    return {
      error:
        'Command not allowed. Inspect mode permits read-only pipes, but redirects, command chaining, backgrounding, and subshells are blocked.',
    };
  }

  const argv = tokenizeCommand(normalized);
  if (argv.length === 0) {
    return { error: 'Command not allowed. The command must not be empty.' };
  }

  const policy = classifyCommand(argv, options.rules, options.allowUnknown);
  if (!policy) {
    return {
      error: `Command not allowed by ${options.toolName} policy. This tool only permits bounded commands that match its configured workspace risk/scope rules.`,
    };
  }

  return policy;
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
    if (!allowUnknown) {
      return undefined;
    }

    return {
      binary,
      scope: 'workspace',
      risk: 'unknown',
      capability: 'unknown_workspace',
      reason: 'unclassified workspace command requiring explicit approval',
    };
  }

  return {
    binary: rule.binary,
    scope: rule.scope,
    risk: rule.risk,
    capability: rule.capability,
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

  const input = raw as { command?: unknown };
  return typeof input.command === 'string';
}

function containsBlockedShellControlOperators(command: string, toolName: string): boolean {
  const inspectMode = toolName === 'run_shell_inspect';
  if (!inspectMode) {
    return false;
  }
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index++) {
    const current = command[index] ?? '';
    const next = command[index + 1] ?? '';

    if (escaped) {
      escaped = false;
      continue;
    }

    if (current === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (current === quote) {
        quote = undefined;
      }
      continue;
    }

    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }

    if (current === '|' && inspectMode && next === '|') {
      return true;
    }

    if (current === '&' && next === '&') {
      return true;
    }

    if (current === ';' || current === '`') {
      return true;
    }

    if (current === '&') {
      return true;
    }

    if (inspectMode && (current === '>' || current === '<')) {
      return true;
    }

    if (current === '$' && next === '(') {
      return true;
    }
  }

  return false;
}

function getCatastrophicCommandError(command: string, toolName: string): string | undefined {
  if (toolName !== 'run_shell_mutate') {
    return undefined;
  }

  const normalized = command.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) {
    return undefined;
  }

  const catastrophicPatterns = [
    /(?:^|[;&|])\s*rm\s+-rf\s+\/$/,
    /(?:^|[;&|])\s*rm\s+-rf\s+\/\s/,
    /(?:^|[;&|])\s*rm\s+-rf\s+~(?:\/|$)/,
    /(?:^|[;&|])\s*rm\s+-rf\s+\$home(?:\/|$)/,
    /(?:^|[;&|])\s*rm\s+-rf\s+"?\/"?(?:\s|$)/,
    /(?:^|[;&|])\s*rm\s+-rf\s+"?~"?(?:\s|$)/,
    /(?:^|[;&|])\s*mkfs(?:\.[^\s]+)?\b/,
    /(?:^|[;&|])\s*dd\b.*\bof=\/dev\//,
  ];

  return catastrophicPatterns.some((pattern) => pattern.test(normalized)) ?
      'Command not allowed. This command appears catastrophically destructive (home/root/disk-level) and is blocked even in approval-gated mutate mode.'
    : undefined;
}

function inspectRule(
  binary: string,
  capability: RunShellCapability,
  reason: string,
  argsPrefix?: string[],
): RunShellRule {
  return {
    binary,
    argsPrefix,
    scope: 'inspect',
    risk: 'low',
    capability,
    reason,
  };
}

function workspaceRule(
  binary: string,
  risk: RunShellRisk,
  capability: RunShellCapability,
  reason: string,
  argsPrefix?: string[],
): RunShellRule {
  return {
    binary,
    argsPrefix,
    scope: 'workspace',
    risk,
    capability,
    reason,
  };
}
