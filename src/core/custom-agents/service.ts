import { createHash } from 'node:crypto';
import { CustomAgentDefinitionRepository } from './definition-repository.js';
import type {
  CustomAgentCatalog,
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
}
