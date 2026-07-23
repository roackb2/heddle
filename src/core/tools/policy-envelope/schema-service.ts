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
    'Optional agent-declared intent envelope for approval/autopilot policy. Use this to honestly declare the purpose, operation categories, expected impact surface, target roots, proposed environment, and confidence for this tool call. The harness treats this as a claim, reconciles it with immutable host authority, transport, environment, and tenant facts, then decides whether to allow, request approval, or deny the action.',
  properties: {
    operations: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        enum: [...TOOL_POLICY_OPERATIONS],
      },
      description: 'Effect categories the agent expects this tool call to perform. Use multiple values when appropriate. Do not add "network" merely because the host uses HTTP or another network transport; transport is host-owned provenance.',
    },
    intent: {
      type: 'string',
      description: 'Short natural-language statement of what the agent intends this tool call to accomplish.',
    },
    targetRoots: {
      type: 'array',
      items: { type: 'string' },
      description: `Project/workspace roots the agent expects this call to touch. May be empty only for read-only or state-only calls that touch no project root, such as planning tools. Calls that write, delete, move, execute, or run git must declare at least one target or write root. ${ROOT_DESCRIPTION}`,
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
      description: 'Environment the agent believes this call targets. When a tool has host-owned environment provenance, the host value is authoritative and this field remains only an auditable proposal.',
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
