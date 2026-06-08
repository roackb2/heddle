import { FileAgentSkillActivationRepository, AgentSkillService } from '@/core/skills/index.js';
import type { ToolDefinition, ToolResult } from '@/core/types.js';

export type ReadAgentSkillToolOptions = {
  workspaceRoot: string;
  stateRoot: string;
};

type ReadAgentSkillInput = {
  name: string;
  resource?: string;
};

export function createReadAgentSkillTool(options: ReadAgentSkillToolOptions): ToolDefinition {
  return {
    name: 'read_agent_skill',
    description:
      'Read the full instructions for an activated Agent Skill by name, or read one resource previously returned by this tool. Use this only after the available_skills catalog says a skill is relevant. This tool returns SKILL.md body instructions and referenced resource hints for active skills only; it will not activate new skills or bypass workspace consent. To read a referenced resource, pass the same skill name and resource as either the resource name or path.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'Name of the activated Agent Skill to read.',
        },
        resource: {
          type: 'string',
          description: 'Optional resource name or path returned by an earlier read_agent_skill call.',
        },
      },
      required: ['name'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isReadAgentSkillInput(raw)) {
        return { ok: false, error: 'Invalid input for read_agent_skill. Required field: name.' };
      }

      if (raw.resource) {
        const resourceResult = await agentSkills(options).readActivatedSkillResource(raw.name, raw.resource);
        if (!resourceResult) {
          return {
            ok: false,
            error: `Agent Skill resource is not active, was not found, or is not referenced by the skill: ${raw.name} ${raw.resource}`,
          };
        }

        return {
          ok: true,
          output: {
            name: resourceResult.skill.name,
            resource: resourceResult.resource,
            content: resourceResult.content,
          },
        };
      }

      const result = await agentSkills(options).readActivatedSkill(raw.name);
      if (!result) {
        return {
          ok: false,
          error: `Agent Skill is not active or was not found: ${raw.name}`,
        };
      }

      return {
        ok: true,
        output: {
          name: result.skill.name,
          source: result.skill.source,
          location: result.skill.skillFilePath,
          body: result.body,
          resources: result.resources,
        },
      };
    },
  };
}

function isReadAgentSkillInput(raw: unknown): raw is ReadAgentSkillInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  return Object.keys(input).every((key) => key === 'name' || key === 'resource')
    && typeof input.name === 'string'
    && input.name.trim().length > 0
    && (input.resource === undefined || typeof input.resource === 'string');
}

function agentSkills(options: ReadAgentSkillToolOptions): AgentSkillService {
  return new AgentSkillService({
    workspaceRoot: options.workspaceRoot,
    activationStore: new FileAgentSkillActivationRepository({ stateRoot: options.stateRoot }),
  });
}
