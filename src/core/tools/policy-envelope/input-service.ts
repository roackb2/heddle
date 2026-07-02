import { z } from 'zod';
import {
  TOOL_POLICY_CONFIDENCE_LEVELS,
  TOOL_POLICY_DESTRUCTIVE_SCOPES,
  TOOL_POLICY_ENVIRONMENTS,
  TOOL_POLICY_OPERATIONS,
  type ToolPolicyEnvelope,
  type ToolPolicyEnvelopeExtraction,
} from './types.js';

const ToolPolicyEnvelopeSchema = z.object({
  operations: z.array(z.enum(TOOL_POLICY_OPERATIONS)).min(1).describe(
    'Operation categories the agent claims this tool call may perform. Multiple values are valid because one call can combine execution, writes, deletes, git, or network effects.',
  ),
  intent: z.string().min(1).describe(
    'Human-readable purpose for the tool call. Used for approval/debugging context, not for deterministic verification.',
  ),
  targetRoots: z.array(z.string()).describe(
    'Project/workspace roots involved in the call. These should be project boundaries such as repo roots or config-bearing folders, not individual file paths. May be empty for calls that touch no project root, such as planning or state-only tools.',
  ),
  readRoots: z.array(z.string()).optional().describe(
    'Optional project/workspace roots the agent claims the call may read when read scope differs from targetRoots.',
  ),
  writeRoots: z.array(z.string()).optional().describe(
    'Optional project/workspace roots the agent claims the call may mutate when write/delete/move scope differs from targetRoots.',
  ),
  expectedEffects: z.array(z.string()).describe(
    'Short effect claims for trace review and policy tuning, such as files edited, generated files deleted, or git staging performed.',
  ),
  maxDestructiveScope: z.enum(TOOL_POLICY_DESTRUCTIVE_SCOPES).optional().describe(
    'Largest destructive impact the agent expects from this call. This is a declared upper bound used by autonomy policy.',
  ),
  environment: z.enum(TOOL_POLICY_ENVIRONMENTS).describe(
    'Environment the agent believes the call targets. Autonomy policy uses this to distinguish local/dev work from staging, production, or unknown targets.',
  ),
  confidence: z.enum(TOOL_POLICY_CONFIDENCE_LEVELS).describe(
    'Agent confidence that the envelope completely describes the purpose and impact surface of the call.',
  ),
}).strip().describe(
  'Developer-facing validator for the shared ToolPolicyEnvelope shape. It validates the agent declaration before approval/autonomy policy consumes it, then strips the envelope from tool business input.',
);

type AssertExactSchemaShape<Actual, Expected> = Actual extends Expected
  ? Expected extends Actual
    ? true
    : never
  : never;

const toolPolicyEnvelopeSchemaConformsToDeclaredShape: AssertExactSchemaShape<
  z.infer<typeof ToolPolicyEnvelopeSchema>,
  ToolPolicyEnvelope
> = true;

void toolPolicyEnvelopeSchemaConformsToDeclaredShape;

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
