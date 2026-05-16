import type { ToolCall } from '@/core/types.js';
import {
  classifyShellCommandPolicy,
  DEFAULT_MUTATE_RULES,
  type RunShellCapability,
  type RunShellScope,
} from '@/core/tools/toolkits/shell-process/run-shell.js';
import type { ProjectApprovalRule } from './types.js';

/**
 * Owns remembered approval rule semantics: target extraction, matching,
 * normalization, rule creation, and user-facing descriptions.
 */
export class ProjectApprovalRules {
  static normalizeCommand(command: string): string {
    return ProjectApprovalRules.canonicalizeVerificationCommand(command.trim().replace(/\s+/g, ' '));
  }

  static findMatching(args: {
    rules: ProjectApprovalRule[];
    tool: string;
    input: unknown;
  }): ProjectApprovalRule | undefined {
    const target = ProjectApprovalRules.extractTarget({
      tool: args.tool,
      input: args.input,
    });
    if (!target) {
      return undefined;
    }

    return args.rules.find((rule) => {
      if (rule.tool !== args.tool) {
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

  static createForCommand(command: string): ProjectApprovalRule {
    return ProjectApprovalRules.createShellRule(ProjectApprovalRules.normalizeCommand(command));
  }

  static createForCall(call: ToolCall): ProjectApprovalRule | undefined {
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

    if (call.tool === 'read_file' || call.tool === 'list_files') {
      const target = ProjectApprovalRules.extractTarget({ tool: call.tool, input: call.input });
      return target ? {
        tool: call.tool,
        mode: 'exact',
        command: target,
        scope: 'outside_workspace',
        capability: 'file_inspection',
        createdAt: new Date().toISOString(),
      } : undefined;
    }

    if (call.tool !== 'run_shell_mutate') {
      return undefined;
    }

    const target = ProjectApprovalRules.extractTarget({ tool: call.tool, input: call.input });
    return target ? ProjectApprovalRules.createShellRule(target) : undefined;
  }

  static describe(rule: ProjectApprovalRule): string {
    if (rule.tool === 'edit_file') {
      return 'allow edit_file for this project';
    }

    if (rule.tool === 'read_file' || rule.tool === 'list_files') {
      return `allow ${rule.tool} for this project`;
    }

    if (rule.mode === 'prefix') {
      return `allow ${rule.command} command family for this project`;
    }

    return 'allow exact command';
  }

  static extractTarget(args: {
    tool: string;
    input: unknown;
  }): string | undefined {
    if (args.tool === 'run_shell_mutate') {
      if (typeof args.input === 'string') {
        return ProjectApprovalRules.normalizeCommand(args.input);
      }

      if (!args.input || typeof args.input !== 'object' || Array.isArray(args.input)) {
        return undefined;
      }

      const command = (args.input as { command?: unknown }).command;
      return typeof command === 'string' && command.trim() ? ProjectApprovalRules.normalizeCommand(command) : undefined;
    }

    if (args.tool === 'edit_file' || args.tool === 'read_file' || args.tool === 'list_files') {
      if (typeof args.input === 'string') {
        return ProjectApprovalRules.normalizePath(args.input);
      }

      if (!args.input || typeof args.input !== 'object' || Array.isArray(args.input)) {
        return undefined;
      }

      const path = (args.input as { path?: unknown }).path;
      return typeof path === 'string' && path.trim() ? ProjectApprovalRules.normalizePath(path) : undefined;
    }

    return undefined;
  }

  static normalizePath(path: string): string {
    const trimmed = path.trim();
    if (trimmed === './' || trimmed === '.') {
      return '.';
    }

    return trimmed.replace(/\/+$/, '') || '.';
  }

  static buildLegacyVerificationPrefix(command: string): string | undefined {
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

  private static createShellRule(command: string): ProjectApprovalRule {
    const policy = classifyShellCommandPolicy(command, {
      toolName: 'run_shell_mutate',
      rules: DEFAULT_MUTATE_RULES,
      allowUnknown: true,
    });

    if (!('error' in policy) && ProjectApprovalRules.shouldUseVerificationPrefixApproval(command, policy.scope, policy.capability)) {
      return {
        tool: 'run_shell_mutate',
        mode: 'prefix',
        command: ProjectApprovalRules.buildVerificationPrefix(command),
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

  private static shouldUseVerificationPrefixApproval(
    command: string,
    scope: RunShellScope,
    capability: RunShellCapability,
  ): boolean {
    if (scope !== 'workspace' || capability !== 'verification') {
      return false;
    }

    return ProjectApprovalRules.buildVerificationPrefix(command) !== command;
  }

  private static buildVerificationPrefix(command: string): string {
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

  private static canonicalizeVerificationCommand(command: string): string {
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
}
