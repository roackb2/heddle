import type { ToolDefinition } from '@/core/types.js';
import {
  TOOL_POLICY_CONFIDENCE_LEVELS,
  TOOL_POLICY_DESTRUCTIVE_SCOPES,
  TOOL_POLICY_ENVIRONMENTS,
  TOOL_POLICY_OPERATIONS,
} from './types.js';

const ROOT_DESCRIPTION =
  'A root is a project/workspace boundary, usually a git repository root or a folder with project config such as package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, or similar. Use the narrowest project root involved, not an individual file path.';

const POLICY_ENVELOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description:
    'Optional agent-declared intent envelope for approval/autopilot policy. This is a claim, not runtime-verified fact.',
  properties: {
    operations: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        enum: [...TOOL_POLICY_OPERATIONS],
      },
      description: 'Operation categories the agent expects this tool call to perform. Use multiple values when appropriate.',
    },
    intent: {
      type: 'string',
      description: 'Short natural-language statement of what the agent intends this tool call to accomplish.',
    },
    targetRoots: {
      type: 'array',
      items: { type: 'string' },
      description: `Project/workspace roots the agent expects this call to touch. ${ROOT_DESCRIPTION}`,
    },
    readRoots: {
      type: 'array',
      items: { type: 'string' },
      description: `Project/workspace roots the agent expects this call may read. ${ROOT_DESCRIPTION}`,
    },
    writeRoots: {
      type: 'array',
      items: { type: 'string' },
      description: `Project/workspace roots the agent expects this call may write, delete, move, or otherwise mutate. ${ROOT_DESCRIPTION}`,
    },
    expectedEffects: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concise expected effects, useful for later trace review and policy tuning.',
    },
    maxDestructiveScope: {
      type: 'string',
      enum: [...TOOL_POLICY_DESTRUCTIVE_SCOPES],
      description: 'Largest destructive effect the agent expects.',
    },
    environment: {
      type: 'string',
      enum: [...TOOL_POLICY_ENVIRONMENTS],
      description: 'Environment the agent believes this call targets.',
    },
    confidence: {
      type: 'string',
      enum: [...TOOL_POLICY_CONFIDENCE_LEVELS],
      description: 'Confidence in the declared envelope.',
    },
  },
  required: ['operations', 'intent', 'targetRoots', 'expectedEffects', 'environment', 'confidence'],
};

/**
 * Adds the shared optional policy envelope to model-visible object schemas.
 */
export class ToolPolicyEnvelopeSchemaService {
  static addToTool(tool: ToolDefinition): ToolDefinition {
    return {
      ...tool,
      parameters: ToolPolicyEnvelopeSchemaService.addToParameters(tool.parameters),
    };
  }

  static addToParameters(parameters: Record<string, unknown>): Record<string, unknown> {
    if (parameters.type !== 'object') {
      return parameters;
    }

    const properties = isRecord(parameters.properties) ? parameters.properties : {};
    if (Object.prototype.hasOwnProperty.call(properties, 'policy')) {
      return parameters;
    }

    return {
      ...parameters,
      properties: {
        ...properties,
        policy: POLICY_ENVELOPE_SCHEMA,
      },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
