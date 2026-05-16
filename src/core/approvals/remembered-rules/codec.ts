import type { ProjectApprovalRule } from './types.js';
import type { RunShellCapability } from '@/core/tools/toolkits/shell-process/run-shell.js';
import { ProjectApprovalRules } from './service.js';
import { ProjectApprovalRuleCandidateSchema, ProjectApprovalRuleListSchema } from './schemas.js';

/**
 * Owns persisted approval-rule JSON validation and tolerant legacy parsing.
 *
 * Reads are forgiving so a malformed or older approval file does not crash the
 * host. Writes are strict and go through the same Zod schema used for reads.
 */
export class ProjectApprovalRuleCodec {
  static parseList(value: unknown): ProjectApprovalRule[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return ProjectApprovalRuleCodec.dedupeRules(
      value.flatMap((rule) => ProjectApprovalRuleCodec.parseRule(rule)),
    );
  }

  static serialize(rules: ProjectApprovalRule[]): string {
    return `${JSON.stringify(ProjectApprovalRuleListSchema.parse(rules), null, 2)}\n`;
  }

  private static parseRule(value: unknown): ProjectApprovalRule[] {
    const parsed = ProjectApprovalRuleCandidateSchema.safeParse(value);
    if (!parsed.success) {
      return [];
    }

    const candidate = parsed.data;
    if (candidate.tool === 'run_shell_mutate' && typeof candidate.command === 'string' && typeof candidate.createdAt === 'string') {
      return ProjectApprovalRuleCodec.parseShellRule({
        mode: candidate.mode,
        command: candidate.command,
        scope: candidate.scope,
        capability: candidate.capability,
        createdAt: candidate.createdAt,
      });
    }

    if (candidate.tool === 'edit_file' && candidate.mode === 'tool' && typeof candidate.createdAt === 'string') {
      return [{
        tool: 'edit_file',
        mode: 'tool',
        command: '*',
        scope: 'workspace',
        capability: 'file_edit',
        createdAt: candidate.createdAt,
      }];
    }

    if (
      (candidate.tool === 'read_file' || candidate.tool === 'list_files') &&
      candidate.mode === 'exact' &&
      typeof candidate.command === 'string' &&
      typeof candidate.createdAt === 'string'
    ) {
      return [{
        tool: candidate.tool,
        mode: 'exact',
        command: ProjectApprovalRules.normalizePath(candidate.command),
        scope: 'outside_workspace',
        capability: 'file_inspection',
        createdAt: candidate.createdAt,
      }];
    }

    return [];
  }

  private static parseShellRule(value: {
    mode?: string;
    command: string;
    scope?: string;
    capability?: string;
    createdAt: string;
  }): ProjectApprovalRule[] {
    if (value.mode === 'exact' || value.mode === 'prefix') {
      return [{
        tool: 'run_shell_mutate',
        mode: value.mode,
        command: ProjectApprovalRules.normalizeCommand(value.command),
        scope: value.scope === 'external' ? 'external' : value.scope === 'inspect' ? 'inspect' : 'workspace',
        capability: ProjectApprovalRuleCodec.normalizeShellCapability(value.capability),
        createdAt: value.createdAt,
      }];
    }

    const normalizedCommand = ProjectApprovalRules.normalizeCommand(value.command);
    const legacyVerificationPrefix = ProjectApprovalRules.buildLegacyVerificationPrefix(normalizedCommand);
    if (legacyVerificationPrefix) {
      return [{
        tool: 'run_shell_mutate',
        mode: 'prefix',
        command: legacyVerificationPrefix,
        scope: 'workspace',
        capability: 'verification',
        createdAt: value.createdAt,
      }];
    }

    const migrated = ProjectApprovalRules.createForCommand(normalizedCommand);
    return [{ ...migrated, createdAt: value.createdAt }];
  }

  private static dedupeRules(rules: ProjectApprovalRule[]): ProjectApprovalRule[] {
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

  private static normalizeShellCapability(value: string | undefined): RunShellCapability {
    return ProjectApprovalRuleCodec.SHELL_CAPABILITIES.has(value as RunShellCapability)
      ? value as RunShellCapability
      : 'unknown_workspace';
  }

  private static readonly SHELL_CAPABILITIES = new Set<RunShellCapability>([
    'workspace_listing',
    'file_inspection',
    'workspace_search',
    'structured_inspection',
    'environment_inspection',
    'git_inspection',
    'dependency',
    'verification',
    'formatting',
    'file_operation',
    'git_staging',
    'project_script',
    'unknown_workspace',
  ]);
}
