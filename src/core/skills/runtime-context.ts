import { FileAgentSkillActivationRepository } from './activation-repository.js';
import { AgentSkillService } from './service.js';

export type AppendAgentSkillsSystemContextOptions = {
  workspaceRoot: string;
  stateRoot: string;
  systemContext?: string;
  readToolName?: string;
};

/**
 * Composes activated Agent Skills into the agent's progressive-disclosure
 * system context. It only exposes catalog metadata; full skill bodies remain
 * behind the read tool.
 */
export class AgentSkillsRuntimeContextService {
  static async appendActivatedCatalog(
    options: AppendAgentSkillsSystemContextOptions,
  ): Promise<string | undefined> {
    const service = new AgentSkillService({
      workspaceRoot: options.workspaceRoot,
      activationStore: new FileAgentSkillActivationRepository({ stateRoot: options.stateRoot }),
    });
    const catalog = await service.loadActivatedCatalog();

    if (catalog.skills.length === 0) {
      return options.systemContext;
    }

    return [
      options.systemContext,
      service.formatCatalogPrompt(catalog, {
        readToolName: options.readToolName,
      }),
    ].filter((part): part is string => Boolean(part?.trim())).join('\n\n');
  }
}
