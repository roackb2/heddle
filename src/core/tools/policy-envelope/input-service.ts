import { z } from 'zod';
import {
  TOOL_POLICY_CONFIDENCE_LEVELS,
  TOOL_POLICY_DESTRUCTIVE_SCOPES,
  TOOL_POLICY_ENVIRONMENTS,
  TOOL_POLICY_OPERATIONS,
  type ToolPolicyEnvelopeExtraction,
} from './types.js';

const ToolPolicyEnvelopeSchema = z.object({
  operations: z.array(z.enum(TOOL_POLICY_OPERATIONS)).min(1),
  intent: z.string().min(1),
  targetRoots: z.array(z.string()).min(1),
  readRoots: z.array(z.string()).optional(),
  writeRoots: z.array(z.string()).optional(),
  expectedEffects: z.array(z.string()),
  maxDestructiveScope: z.enum(TOOL_POLICY_DESTRUCTIVE_SCOPES).optional(),
  environment: z.enum(TOOL_POLICY_ENVIRONMENTS),
  confidence: z.enum(TOOL_POLICY_CONFIDENCE_LEVELS),
}).strip();

/**
 * Separates the shared policy envelope from tool-owned business input.
 */
export class ToolPolicyEnvelopeInputService {
  static extract(input: unknown): ToolPolicyEnvelopeExtraction {
    if (!isRecord(input) || !Object.prototype.hasOwnProperty.call(input, 'policy')) {
      return { toolInput: input };
    }

    const { policy: rawPolicy, ...toolInput } = input;
    if (rawPolicy === undefined) {
      return { toolInput };
    }

    const parsed = ToolPolicyEnvelopeSchema.safeParse(rawPolicy);
    if (!parsed.success) {
      return {
        toolInput,
        error: `Invalid tool policy envelope: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      };
    }

    return {
      envelope: parsed.data,
      toolInput,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
