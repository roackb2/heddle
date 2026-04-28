// ---------------------------------------------------------------------------
// Tool: report_state
// Record current rationale, uncertainty, or missing needs in a structured way.
// ---------------------------------------------------------------------------

import type { ToolDefinition, ToolResult } from '../types.js';

type ReportStateInput = {
  rationale: string;
  missing?: string[];
  nextNeed?: string;
};

export const reportStateTool: ToolDefinition = {
  name: 'report_state',
  description:
    'Report a genuine blocker or missing requirement in a structured way. Use this when progress is actually blocked by missing information, missing tool support, missing inputs, or a runtime limitation that prevents the next concrete action. Do not use it for ordinary progress updates or to restate a plan you can already execute. This tool does not inspect or change the environment. It records what is missing and the single most important next thing you need so future maintainers can understand the blocker. Returns the same structured report back. Example input: { "rationale": "I need to inspect the top-level directory first.", "missing": ["Top-level directory contents"], "nextNeed": "list_files on ." }',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      rationale: {
        type: 'string',
        description: 'Why you are taking or considering the next step',
      },
      missing: {
        type: 'array',
        items: { type: 'string' },
        description: 'Information or evidence you are missing',
      },
      nextNeed: {
        type: 'string',
        description: 'The single most important next thing you need, such as a tool call, input, or piece of evidence',
      },
    },
    required: ['rationale'],
  },
  async execute(raw: unknown): Promise<ToolResult> {
    if (!isReportStateInput(raw)) {
      return {
        ok: false,
        error:
          'Invalid input for report_state. Required field: rationale. Optional fields: missing, nextNeed.',
      };
    }

    return { ok: true, output: raw };
  },
};

function isReportStateInput(raw: unknown): raw is ReportStateInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.some(
      (key) =>
        key !== 'rationale' &&
        key !== 'missing' &&
        key !== 'nextNeed',
    )
  ) {
    return false;
  }

  if (typeof input.rationale !== 'string') {
    return false;
  }

  if (input.missing !== undefined && !isStringArray(input.missing)) {
    return false;
  }

  if (input.nextNeed !== undefined && typeof input.nextNeed !== 'string') {
    return false;
  }

  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
