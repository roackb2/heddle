import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ProjectApprovalRule = {
  tool: 'run_shell_mutate';
  command: string;
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

    return parsed.filter(isProjectApprovalRule);
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
  return command.trim().replace(/\s+/g, ' ');
}

export function findMatchingApprovalRule(
  rules: ProjectApprovalRule[],
  tool: string,
  command: string | undefined,
): ProjectApprovalRule | undefined {
  if (tool !== 'run_shell_mutate' || !command) {
    return undefined;
  }

  const normalized = normalizeApprovedCommand(command);
  return rules.find((rule) => rule.tool === 'run_shell_mutate' && rule.command === normalized);
}

export function createProjectApprovalRule(command: string): ProjectApprovalRule {
  return {
    tool: 'run_shell_mutate',
    command: normalizeApprovedCommand(command),
    createdAt: new Date().toISOString(),
  };
}

function isProjectApprovalRule(value: unknown): value is ProjectApprovalRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ProjectApprovalRule>;
  return (
    candidate.tool === 'run_shell_mutate' &&
    typeof candidate.command === 'string' &&
    typeof candidate.createdAt === 'string'
  );
}
