import { createReadAgentSkillTool } from './read-agent-skill.js';
import type { ToolToolkit } from '../../toolkit.js';

export const agentSkillsToolkit: ToolToolkit = {
  id: 'agent-skills',
  createTools(context) {
    return [
      createReadAgentSkillTool({
        workspaceRoot: context.workspaceRoot,
        stateRoot: context.stateRoot,
      }),
    ];
  },
};
