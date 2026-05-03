import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolCall } from '../types.js';
import {
  classifyShellCommandPolicy,
  DEFAULT_MUTATE_RULES,
  type RunShellCapability,
  type RunShellScope,
} from '../tools/toolkits/internal/run-shell.js';

type ApprovalMode = 'exact' | 'prefix' | 'tool';

export type ProjectApprovalRule = {
  tool: 'run_shell_mutate' | 'edit_file';
  mode: ApprovalMode;
  command: string;
  scope: RunShellScope | 'workspace';
  capability: RunShellCapability | 'file_edit';
  createdAt: string;
};

export function loadProjectApprovalRules(filePath: string): ProjectApprovalRule[] {
  try {
    if (!existsSync(filePath)) {
      return [];
    }

    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const rules = parsed.flatMap((value) => parseProjectApprovalRule(value));
    return dedupeApprovalRules(rules);
  } catch (error) {
    process.stderr.write(
      `Failed to load project approval rules from ${filePath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return [];
  }
}

export function saveProjectApprovalRules(filePath: string, rules: ProjectApprovalRule[]) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(rules, null, 2)}\n`);
}

export function normalizeApprovedCommand(command: string): string {
  return canonicalizeVerificationCommand(command.trim().replace(/\s+/g, ' '));
}

export function findMatchingApprovalRule(
  rules: ProjectApprovalRule[],
  tool: string,
  input: unknown,
): ProjectApprovalRule | undefined {
  const target = extractApprovalTarget(tool, input);
  if (!target) {
    return undefined;
  }

  return rules.find((rule) => {
    if (rule.tool !== tool) {
      return false;
    }

    if (rule.mode === 'tool') {
      return true;
    }

    if (rule.mode === 'prefix') {
      return target === rule.command || target.startsWith(`${rule.command} `);
    }

    return rule.command === target;
  });
}

export function createProjectApprovalRule(command: string): ProjectApprovalRule {
  return createShellApprovalRule(normalizeApprovedCommand(command));
}

export function createProjectApprovalRuleForCall(call: ToolCall): ProjectApprovalRule | undefined {
  if (call.tool === 'edit_file') {
    return {
      tool: 'edit_file',
      mode: 'tool',
      command: '*',
      scope: 'workspace',
      capability: 'file_edit',
      createdAt: new Date().toISOString(),
    };
  }

  if (call.tool !== 'run_shell_mutate') {
    return undefined;
  }

  const target = extractApprovalTarget(call.tool, call.input);
  return target ? createShellApprovalRule(target) : undefined;
}

export function describeProjectApprovalRule(rule: ProjectApprovalRule): string {
  if (rule.tool === 'edit_file') {
    return 'allow edit_file for this project';
  }

  if (rule.mode === 'prefix') {
    return `allow ${rule.command} command family for this project`;
  }

  return `allow exact command ${rule.command} for this project`;
}

export function extractApprovalTarget(tool: string, input: unknown): string | undefined {
  if (tool === 'run_shell_mutate') {
    if (typeof input === 'string') {
      return normalizeApprovedCommand(input);
    }

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return undefined;
    }

    const command = (input as { command?: unknown }).command;
    return typeof command === 'string' && command.trim() ? normalizeApprovedCommand(command) : undefined;
  }

  if (tool === 'edit_file') {
    if (typeof input === 'string') {
      return normalizeApprovalPath(input);
    }

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return undefined;
    }

    const path = (input as { path?: unknown }).path;
    return typeof path === 'string' && path.trim() ? normalizeApprovalPath(path) : undefined;
  }

  return undefined;
}

function createShellApprovalRule(command: string): ProjectApprovalRule {
  const policy = classifyShellCommandPolicy(command, {
    toolName: 'run_shell_mutate',
    rules: DEFAULT_MUTATE_RULES,
    allowUnknown: true,
  });

  if (!('error' in policy) && shouldUseVerificationPrefixApproval(command, policy.scope, policy.capability)) {
    return {
      tool: 'run_shell_mutate',
      mode: 'prefix',
      command: buildVerificationPrefix(command),
      scope: policy.scope,
      capability: policy.capability,
      createdAt: new Date().toISOString(),
    };
  }

  if (!('error' in policy)) {
    return {
      tool: 'run_shell_mutate',
      mode: 'exact',
      command,
      scope: policy.scope,
      capability: policy.capability,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    tool: 'run_shell_mutate',
    mode: 'exact',
    command,
    scope: 'workspace',
    capability: 'unknown_workspace',
    createdAt: new Date().toISOString(),
  };
}

function shouldUseVerificationPrefixApproval(
  command: string,
  scope: RunShellScope,
  capability: RunShellCapability,
): boolean {
  if (scope !== 'workspace' || capability !== 'verification') {
    return false;
  }

  return buildVerificationPrefix(command) !== command;
}

function buildVerificationPrefix(command: string): string {
  const argv = command.split(' ').filter(Boolean);
  if (argv.length === 0) {
    return command;
  }

  if (argv[0] === 'yarn' && typeof argv[1] === 'string' && !argv[1].startsWith('-')) {
    return `${argv[0]} ${argv[1]}`;
  }

  if (argv[0] === 'vitest' && typeof argv[1] === 'string' && !argv[1].startsWith('-')) {
    return `${argv[0]} ${argv[1]}`;
  }

  if (argv[0] === 'tsc') {
    return 'tsc';
  }

  return command;
}

function canonicalizeVerificationCommand(command: string): string {
  const argv = command.split(' ').filter(Boolean);
  if (argv.length === 0) {
    return command;
  }

  if (argv[0] === 'npx' && typeof argv[1] === 'string') {
    if (argv[1] === 'tsc') {
      return ['tsc', ...argv.slice(2)].join(' ');
    }
    if (argv[1] === 'vitest') {
      return ['vitest', ...argv.slice(2)].join(' ');
    }
    if (argv[1] === 'eslint') {
      return ['eslint', ...argv.slice(2)].join(' ');
    }
  }

  if (argv[0] === './node_modules/.bin/tsc' || argv[0] === 'node_modules/.bin/tsc') {
    return ['tsc', ...argv.slice(1)].join(' ');
  }

  if (argv[0] === './node_modules/.bin/vitest' || argv[0] === 'node_modules/.bin/vitest') {
    return ['vitest', ...argv.slice(1)].join(' ');
  }

  if (argv[0] === './node_modules/.bin/eslint' || argv[0] === 'node_modules/.bin/eslint') {
    return ['eslint', ...argv.slice(1)].join(' ');
  }

  return command;
}

function normalizeApprovalPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === './' || trimmed === '.') {
    return '.';
  }

  return trimmed.replace(/\/+$/, '') || '.';
}

function buildLegacyVerificationPrefix(command: string): string | undefined {
  const argv = command.split(' ').filter(Boolean);
  if (argv[0] !== 'yarn') {
    return undefined;
  }

  const subcommand = argv[1];
  if (subcommand === 'test' || subcommand === 'build' || subcommand === 'lint' || subcommand === 'vitest') {
    return `yarn ${subcommand}`;
  }

  return undefined;
}

function parseProjectApprovalRule(value: unknown): ProjectApprovalRule[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const candidate = value as Partial<ProjectApprovalRule>;
  if (candidate.tool === 'run_shell_mutate' && typeof candidate.command === 'string' && typeof candidate.createdAt === 'string') {
    if (candidate.mode === 'exact' || candidate.mode === 'prefix') {
      return [{
        tool: 'run_shell_mutate',
        mode: candidate.mode,
        command: normalizeApprovedCommand(candidate.command),
        scope: candidate.scope === 'external' ? 'external' : candidate.scope === 'inspect' ? 'inspect' : 'workspace',
        capability: typeof candidate.capability === 'string' ? candidate.capability : 'unknown_workspace',
        createdAt: candidate.createdAt,
      }];
    }

    const normalizedCommand = normalizeApprovedCommand(candidate.command);
    const legacyVerificationPrefix = buildLegacyVerificationPrefix(normalizedCommand);
    if (legacyVerificationPrefix) {
      return [{
        tool: 'run_shell_mutate',
        mode: 'prefix',
        command: legacyVerificationPrefix,
        scope: 'workspace',
        capability: 'verification',
        createdAt: candidate.createdAt,
      }];
    }

    const migrated = createShellApprovalRule(normalizedCommand);
    return [{ ...migrated, createdAt: candidate.createdAt }];
  }

  if (candidate.tool === 'edit_file' && typeof candidate.createdAt === 'string') {
    if (candidate.mode === 'tool') {
      return [{
        tool: 'edit_file',
        mode: 'tool',
        command: '*',
        scope: 'workspace',
        capability: 'file_edit',
        createdAt: candidate.createdAt,
      }];
    }
  }

  return [];
}

function dedupeApprovalRules(rules: ProjectApprovalRule[]): ProjectApprovalRule[] {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const key = `${rule.tool}:${rule.mode}:${rule.command}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
