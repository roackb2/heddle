import { z } from 'zod';
import {
  TOOL_POLICY_CONFIDENCE_LEVELS,
  TOOL_POLICY_DESTRUCTIVE_SCOPES,
  TOOL_POLICY_ENVIRONMENTS,
  TOOL_POLICY_MUTATING_OPERATIONS,
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
    'Project/workspace roots involved in the call. These should be project boundaries such as repo roots or config-bearing folders, not individual file paths. May be empty only for read-only or state-only calls that touch no project root, such as planning tools. Calls that write, delete, move, execute, or run git must declare at least one target or write root.',
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
}).strict().superRefine((envelope, ctx) => {
  // A mutating envelope must declare a write scope. Autonomy policy derives
  // claimed write roots from writeRoots (or targetRoots for mutating ops), so an
  // empty-root mutating envelope would evaluate against zero roots and could be
  // allowed unattended without any configured root/capability check.
  const mutates = envelope.operations.some((operation) => TOOL_POLICY_MUTATING_OPERATIONS.has(operation));
  const declaresRoot = envelope.targetRoots.length > 0 || (envelope.writeRoots?.length ?? 0) > 0;
  if (mutates && !declaresRoot) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetRoots'],
      message: 'mutating operations (write, delete, move, execute, git, unknown) must declare at least one target or write root',
    });
  }
}).describe(
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
        error: `Invalid tool policy envelope: ${parsed.error.issues.map(formatIssue).join('; ')}`,
      };
    }

    return {
      envelope: parsed.data,
      toolInput,
    };
  }
}

function formatIssue(issue: z.ZodIssue): string {
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    return `unsupported model-provided fields [${issue.keys.join(', ')}]; `
      + 'authority, transport, target environment, and tenant provenance are host-owned';
  }

  return issue.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
