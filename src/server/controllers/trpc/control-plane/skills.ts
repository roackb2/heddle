import {
  AgentSkillService,
  FileAgentSkillActivationRepository,
} from '@/core/skills/index.js';

export class ControlPlaneSkillsController {
  static async list(workspaceRoot: string, stateRoot: string) {
    const service = ControlPlaneSkillsController.service(workspaceRoot, stateRoot);
    const overview = await service.listActivationOverview();
    return {
      activationStorePath: FileAgentSkillActivationRepository.resolvePath(stateRoot),
      ...overview,
    };
  }

  static async activate(workspaceRoot: string, stateRoot: string, name: string) {
    return await ControlPlaneSkillsController.service(workspaceRoot, stateRoot).activateSkill(name);
  }

  static async disable(workspaceRoot: string, stateRoot: string, name: string) {
    return await ControlPlaneSkillsController.service(workspaceRoot, stateRoot).disableSkill(name);
  }

  private static service(workspaceRoot: string, stateRoot: string): AgentSkillService {
    return new AgentSkillService({
      workspaceRoot,
      activationStore: new FileAgentSkillActivationRepository({ stateRoot }),
    });
  }
}
