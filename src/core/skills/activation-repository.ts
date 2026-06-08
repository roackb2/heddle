import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AgentSkillSchemas } from './schemas.js';
import type {
  AgentSkillActivationStore,
  AgentSkillActivationStoreOptions,
  AgentSkillActivationStorePort,
} from './types.js';

/**
 * File-backed workspace activation state for Agent Skills.
 *
 * The repository stores only user consent/status metadata. Skill definitions
 * stay in their original `.agents/skills` or built-in package locations.
 */
export class FileAgentSkillActivationRepository implements AgentSkillActivationStorePort {
  private readonly filePath: string;

  constructor(options: AgentSkillActivationStoreOptions) {
    this.filePath = FileAgentSkillActivationRepository.resolvePath(options.stateRoot);
  }

  static resolvePath(stateRoot: string): string {
    return join(stateRoot, 'skills', 'activation.json');
  }

  read(): AgentSkillActivationStore {
    if (!existsSync(this.filePath)) {
      return AgentSkillSchemas.emptyActivationStore();
    }

    try {
      return AgentSkillSchemas.parseActivationStore(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch {
      return AgentSkillSchemas.emptyActivationStore();
    }
  }

  write(store: AgentSkillActivationStore): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(AgentSkillSchemas.parseActivationStore(store), null, 2)}\n`, 'utf8');
  }
}
