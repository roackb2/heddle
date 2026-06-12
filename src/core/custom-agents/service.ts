import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { CustomAgentFrontmatterSchema } from './schemas.js';
import { CustomAgentDefinitionRepository } from './definition-repository.js';
import type {
  CustomAgentCatalog,
  CustomAgentCreateInput,
  CustomAgentCreateResult,
  CustomAgentDeleteResult,
  CustomAgentDefinition,
  CustomAgentExecutionSnapshot,
  CustomAgentOption,
} from './types.js';

export type CustomAgentServiceOptions = {
  workspaceRoot: string;
  homeDir?: string;
};

/**
 * Owns custom-agent catalog reads and conversion to immutable turn execution snapshots.
 */
export class CustomAgentService {
  constructor(private readonly options: CustomAgentServiceOptions) {}

  catalog(): CustomAgentCatalog {
    return new CustomAgentDefinitionRepository(this.options).readCatalog();
  }

  listOptions(): CustomAgentOption[] {
    return this.catalog().agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      modeAlias: agent.modeAlias,
      source: agent.source,
    }));
  }

  resolveExecutionSnapshot(agentProfileId: string | undefined): CustomAgentExecutionSnapshot | undefined {
    if (!agentProfileId) {
      return undefined;
    }

    const catalog = this.catalog();
    const agent = catalog.agents.find((candidate) => candidate.id === agentProfileId);
    if (!agent) {
      throw new Error(`Custom agent not found: ${agentProfileId}`);
    }

    return CustomAgentService.toExecutionSnapshot(agent);
  }

  /**
   * Persists a project-scoped definition file, then reloads it through the catalog
   * parser so callers receive the same normalized shape used at turn runtime.
   */
  createProjectAgent(input: CustomAgentCreateInput): CustomAgentCreateResult {
    const catalog = this.catalog();
    if (catalog.agents.some((agent) => agent.id === input.id)) {
      throw new Error(`Custom agent already exists: ${input.id}`);
    }

    const definitionPath = join(this.options.workspaceRoot, '.agents', 'agents', input.id, 'AGENT.md');
    CustomAgentService.assertProjectDefinitionPath(this.options.workspaceRoot, definitionPath);
    if (existsSync(definitionPath)) {
      throw new Error(`Custom agent definition already exists: ${definitionPath}`);
    }

    const frontmatter = CustomAgentFrontmatterSchema.parse({
      schemaVersion: 1,
      id: input.id,
      name: input.name,
      description: input.description,
      modeAlias: input.modeAlias,
      runtime: input.maxSteps ? { maxSteps: input.maxSteps } : {},
      tools: { preset: input.toolsPreset },
      approval: { preset: input.approvalPreset },
    });

    mkdirSync(dirname(definitionPath), { recursive: true });
    writeFileSync(
      definitionPath,
      `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${input.promptAppendix.trim()}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );

    const createdAgent = this.catalog().agents.find((agent) => agent.id === input.id && agent.source === 'project');
    if (!createdAgent) {
      throw new Error(`Custom agent was written but could not be loaded: ${input.id}`);
    }

    return { createdAgent };
  }

  deleteProjectAgent(agentProfileId: string): CustomAgentDeleteResult {
    const catalog = this.catalog();
    const agent = catalog.agents.find((candidate) => candidate.id === agentProfileId);
    if (!agent) {
      throw new Error(`Custom agent not found: ${agentProfileId}`);
    }

    if (agent.source === 'built-in') {
      throw new Error(`Built-in custom agents cannot be deleted: ${agentProfileId}`);
    }

    if (agent.source !== 'project') {
      throw new Error(`Only project custom agents can be deleted from this workspace: ${agentProfileId}`);
    }

    if (!agent.definitionPath) {
      throw new Error(`Project custom agent has no definition path: ${agentProfileId}`);
    }

    CustomAgentService.assertProjectDefinitionPath(this.options.workspaceRoot, agent.definitionPath);
    rmSync(agent.definitionPath, { force: true });
    CustomAgentService.removeDefinitionDirectoryIfEmpty(agent.definitionPath);

    return { deletedAgent: agent };
  }

  static toExecutionSnapshot(agent: CustomAgentDefinition): CustomAgentExecutionSnapshot {
    return {
      agentProfileId: agent.id,
      agentName: agent.name,
      modeAlias: agent.modeAlias,
      source: agent.source,
      definitionHash: CustomAgentService.hashDefinition(agent),
      runtime: agent.runtime,
      toolProfile: agent.tools,
      approvalProfile: agent.approval,
      systemContextAppendix: agent.promptAppendix,
    };
  }

  private static hashDefinition(agent: CustomAgentDefinition): string {
    return createHash('sha256')
      .update(JSON.stringify({
        id: agent.id,
        name: agent.name,
        modeAlias: agent.modeAlias,
        runtime: agent.runtime,
        tools: agent.tools,
        approval: agent.approval,
        promptAppendix: agent.promptAppendix,
      }))
      .digest('hex')
      .slice(0, 16);
  }

  private static assertProjectDefinitionPath(workspaceRoot: string, definitionPath: string): void {
    const projectAgentsRoot = join(workspaceRoot, '.agents', 'agents');
    const relativePath = relative(projectAgentsRoot, definitionPath);
    if (isAbsolute(relativePath) || relativePath.startsWith('..')) {
      throw new Error(`Custom agent definition is outside the project agents directory: ${definitionPath}`);
    }
  }

  private static removeDefinitionDirectoryIfEmpty(definitionPath: string): void {
    const definitionDirectory = dirname(definitionPath);
    if (!existsSync(definitionDirectory)) {
      return;
    }

    try {
      rmdirSync(definitionDirectory);
    } catch {
      // Keep non-empty agent directories intact; only AGENT.md is owned here.
    }
  }
}
