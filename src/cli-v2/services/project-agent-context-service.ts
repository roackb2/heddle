import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Owns cli-v2 bootstrap loading for workspace-local agent instruction files.
 *
 * This is terminal host bootstrap behavior, not core prompt or runtime policy.
 * Command edges receive one resolved `systemContext` string and should not
 * duplicate project-instruction lookup rules on their own.
 */
export class CliV2ProjectAgentContextService {
  static readonly DEFAULT_PATHS = ['HEDDLE.md', 'AGENTS.md', 'CLAUDE.md'];

  static resolvePaths(workspaceRoot: string, configuredPaths: string[] | undefined): string[] {
    if (configuredPaths) {
      return configuredPaths;
    }

    const defaultPath = CliV2ProjectAgentContextService.DEFAULT_PATHS.find((relativePath) =>
      hasReadableProjectAgentContext(workspaceRoot, relativePath)
    );
    return defaultPath ? [defaultPath] : [];
  }

  static load(workspaceRoot: string, paths: string[]): string | undefined {
    const sections = paths.flatMap((relativePath) => {
      const content = readProjectAgentContextFile(workspaceRoot, relativePath);
      return content ? [`Source: ${relativePath}\n${truncate(content, 12000)}`] : [];
    });

    return sections.length > 0 ? sections.join('\n\n') : undefined;
  }
}

function hasReadableProjectAgentContext(workspaceRoot: string, relativePath: string): boolean {
  return readProjectAgentContextFile(workspaceRoot, relativePath) !== undefined;
}

function readProjectAgentContextFile(workspaceRoot: string, relativePath: string): string | undefined {
  const filePath = resolve(workspaceRoot, relativePath);
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    const content = readFileSync(filePath, 'utf8').trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}
