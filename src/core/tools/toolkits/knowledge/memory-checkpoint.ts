import type { ToolDefinition, ToolResult } from '../../../types.js';
import { createRecordKnowledgeTool } from './record-knowledge.js';

export type MemoryCheckpointToolOptions = {
  memoryRoot?: string;
  now?: () => Date;
  nextId?: () => string;
};

type MemoryCheckpointInput = {
  decision: 'record' | 'skip';
  rationale: string;
  candidate?: {
    summary: string;
    evidence?: string[];
    categoryHint?: string;
    importance?: 'low' | 'medium' | 'high';
    confidence?: 'user-stated' | 'tool-verified' | 'inferred' | 'historical';
    sourceRefs?: string[];
  };
};

const MAX_RATIONALE_LENGTH = 1000;

export function createMemoryCheckpointTool(options: MemoryCheckpointToolOptions = {}): ToolDefinition {
  return {
    name: 'memory_checkpoint',
    description:
      'Make the required before-final-answer memory decision for this turn. Use decision "record" when the user explicitly asks to remember something durable, states a future preference/workflow/format, or the turn discovered stable reusable workspace knowledge, recurring session patterns, or operational context that would be costly for a future agent to rediscover. Pay special attention to recurring conversational patterns: repeated requested structures for tickets, PRs, summaries, reviews, handoffs, or required output formats are strong memory candidates. Explicit wording such as "remember this", "use this format going forward", "whenever I ask", or "from now on" should strongly bias toward "record". Use decision "skip" for one-off task details, temporary plans, speculative guesses, duplicate facts, transient command output, or secret-like content. If decision is "record", include candidate with summary, optional evidence[], categoryHint, importance, confidence, and sourceRefs. This records a candidate for later cataloged maintenance; it does not directly edit memory notes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        decision: {
          type: 'string',
          enum: ['record', 'skip'],
          description: 'Whether this turn produced durable memory worth preserving',
        },
        rationale: {
          type: 'string',
          description: 'Brief reason for recording or skipping',
        },
        candidate: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: {
              type: 'string',
              description: 'Concise durable fact or preference to preserve',
            },
            evidence: {
              type: 'array',
              items: { type: 'string' },
              description: 'Short evidence snippets or observations supporting the summary',
            },
            categoryHint: {
              type: 'string',
              description: 'Suggested memory category, such as current-state, workflows, preferences, domain, operations, relationships, or history',
            },
            importance: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Expected future value of this memory candidate',
            },
            confidence: {
              type: 'string',
              enum: ['user-stated', 'tool-verified', 'inferred', 'historical'],
              description: 'Why the candidate should be trusted',
            },
            sourceRefs: {
              type: 'array',
              items: { type: 'string' },
              description: 'Workspace-relative file paths, commands, trace ids, or note references that support the candidate',
            },
          },
          required: ['summary'],
        },
      },
      required: ['decision', 'rationale'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      const parsed = validateMemoryCheckpointInput(raw);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }

      if (parsed.input.decision === 'skip') {
        return {
          ok: true,
          output: {
            decision: parsed.input.decision,
            rationale: parsed.input.rationale,
            message: 'Memory checkpoint skipped recording for this turn.',
          },
        };
      }

      const recordTool = createRecordKnowledgeTool(options);
      const recordResult = await recordTool.execute(parsed.input.candidate);
      if (!recordResult.ok) {
        return recordResult;
      }

      return {
        ok: true,
        output: {
          decision: parsed.input.decision,
          rationale: parsed.input.rationale,
          ...(recordResult.output && typeof recordResult.output === 'object' && !Array.isArray(recordResult.output) ? recordResult.output : {}),
        },
      };
    },
  };
}

function validateMemoryCheckpointInput(raw: unknown): { ok: true; input: MemoryCheckpointInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: invalidInputMessage() };
  }

  const input = raw as Record<string, unknown>;
  const allowedKeys = new Set(['decision', 'rationale', 'candidate']);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: invalidInputMessage() };
  }

  if (input.decision !== 'record' && input.decision !== 'skip') {
    return { ok: false, error: invalidInputMessage() };
  }

  if (typeof input.rationale !== 'string' || !input.rationale.trim() || input.rationale.length > MAX_RATIONALE_LENGTH) {
    return { ok: false, error: `Invalid input for memory_checkpoint. Required field rationale must be a non-empty string up to ${MAX_RATIONALE_LENGTH} characters.` };
  }

  if (input.decision === 'record') {
    if (!input.candidate || typeof input.candidate !== 'object' || Array.isArray(input.candidate)) {
      return { ok: false, error: 'Invalid input for memory_checkpoint. decision "record" requires candidate.' };
    }
    return {
      ok: true,
      input: {
        decision: input.decision,
        rationale: input.rationale.trim(),
        candidate: input.candidate as MemoryCheckpointInput['candidate'],
      },
    };
  }

  if (input.candidate !== undefined && input.candidate !== null) {
    return { ok: false, error: 'Invalid input for memory_checkpoint. decision "skip" must not include candidate.' };
  }

  return {
    ok: true,
    input: {
      decision: input.decision,
      rationale: input.rationale.trim(),
    },
  };
}

function invalidInputMessage(): string {
  return 'Invalid input for memory_checkpoint. Required fields: decision ("record"|"skip"), rationale. Include candidate only when decision is "record".';
}
