import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BUILT_IN_CUSTOM_AGENTS } from './built-ins.js';
import { CustomAgentParser } from './parser.js';
import type {
  CustomAgentCatalog,
  CustomAgentCatalogIssue,
  CustomAgentDefinition,
  CustomAgentSourceKind,
} from './types.js';

type CustomAgentDefinitionRepositoryOptions = {
  workspaceRoot: string;
  homeDir?: string;
};

export class CustomAgentDefinitionRepository {
  constructor(private readonly options: CustomAgentDefinitionRepositoryOptions) {}

  /**
   * Reads all definition sources and returns the effective catalog plus load issues.
   */
  readCatalog(): CustomAgentCatalog {
    const candidates = [
      ...this.readBuiltIns(),
      ...this.readFilesystemDefinitions('user', join(this.options.homeDir ?? homedir(), '.agents', 'agents')),
      ...this.readFilesystemDefinitions('project', join(this.options.workspaceRoot, '.agents', 'agents')),
    ];

    return CustomAgentDefinitionRepository.mergeByPrecedence(candidates);
  }

  private readBuiltIns(): Array<{ agent?: CustomAgentDefinition; issue?: CustomAgentCatalogIssue }> {
    return BUILT_IN_CUSTOM_AGENTS.map((agent) => ({ agent }));
  }

  private readFilesystemDefinitions(
    source: Extract<CustomAgentSourceKind, 'project' | 'user'>,
    root: string,
  ): Array<{ agent?: CustomAgentDefinition; issue?: CustomAgentCatalogIssue }> {
    if (!existsSync(root)) {
      return [];
    }

    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, 'AGENT.md'))
      .filter((path) => existsSync(path))
      .map((path) => this.readDefinitionFile(source, path));
  }

  private readDefinitionFile(
    source: Extract<CustomAgentSourceKind, 'project' | 'user'>,
    path: string,
  ): { agent?: CustomAgentDefinition; issue?: CustomAgentCatalogIssue } {
    try {
      return {
        agent: CustomAgentParser.parseMarkdown({
          content: readFileSync(path, 'utf8'),
          source,
          definitionPath: path,
        }),
      };
    } catch (error) {
      return {
        issue: {
          severity: 'error',
          source,
          path,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Applies source precedence without making runtime or approval decisions.
   */
  private static mergeByPrecedence(
    candidates: Array<{ agent?: CustomAgentDefinition; issue?: CustomAgentCatalogIssue }>,
  ): CustomAgentCatalog {
    const agents = new Map<string, CustomAgentDefinition>();
    const issues = candidates.flatMap((candidate) => candidate.issue ? [candidate.issue] : []);
    const builtInIds = new Set(BUILT_IN_CUSTOM_AGENTS.map((agent) => agent.id));

    for (const { agent } of candidates) {
      if (!agent) {
        continue;
      }

      if (agent.source !== 'built-in' && builtInIds.has(agent.id)) {
        issues.push({
          severity: 'error',
          source: agent.source,
          path: agent.definitionPath,
          message: `Custom agent id "${agent.id}" is reserved by a built-in agent.`,
        });
        continue;
      }

      const existing = agents.get(agent.id);
      if (existing?.source === 'project' && agent.source === 'user') {
        continue;
      }

      if (existing?.source === 'user' && agent.source === 'project') {
        issues.push({
          severity: 'warning',
          source: agent.source,
          path: agent.definitionPath,
          message: `Project custom agent "${agent.id}" overrides the user custom agent with the same id.`,
        });
      }

      if (!existing || agent.source === 'project' || agent.source === 'built-in') {
        agents.set(agent.id, agent);
      }
    }

    return {
      agents: Array.from(agents.values()).sort(CustomAgentDefinitionRepository.compareAgents),
      issues,
    };
  }

  private static compareAgents(left: CustomAgentDefinition, right: CustomAgentDefinition): number {
    return CustomAgentDefinitionRepository.sourceRank(left.source) - CustomAgentDefinitionRepository.sourceRank(right.source)
      || left.name.localeCompare(right.name);
  }

  private static sourceRank(source: CustomAgentSourceKind): number {
    return source === 'built-in' ? 0 : source === 'project' ? 1 : 2;
  }
}
