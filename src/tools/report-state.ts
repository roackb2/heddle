// ---------------------------------------------------------------------------
// Tool: report_state
// Record current rationale, uncertainty, or missing needs in a structured way.
// ---------------------------------------------------------------------------

import type { ToolDefinition, ToolResult } from '../types.js';

type ReportStateInput = {
  rationale: string;
  missing?: string[];
  wantedTools?: string[];
  wantedInputs?: string[];
  confidence?: 'low' | 'medium' | 'high';
};

export const reportStateTool: ToolDefinition = {
  name: 'report_state',
  description:
    'Report your current reasoning state in a structured way. Use this when you are blocked, uncertain, missing information, recovering from repeated low-value exploration, or about to take a speculative path. This does not inspect or change the environment. It records what you think is missing and what tool or input would help next. Returns the same structured report back. Example input: { "rationale": "I need to inspect the top-level directory first.", "missing": ["Top-level directory contents"], "wantedTools": ["list_files"], "wantedInputs": ["path=."], "confidence": "medium" }',
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
      wantedTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tools that would help next',
      },
      wantedInputs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Inputs or arguments that would help next',
      },
      confidence: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Current confidence in your direction',
      },
    },
    required: ['rationale'],
  },
  async execute(raw: unknown): Promise<ToolResult> {
    if (!isReportStateInput(raw)) {
      return {
        ok: false,
        error:
          'Invalid input for report_state. Required field: rationale. Optional fields: missing, wantedTools, wantedInputs, confidence.',
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
        key !== 'wantedTools' &&
        key !== 'wantedInputs' &&
        key !== 'confidence',
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

  if (input.wantedTools !== undefined && !isStringArray(input.wantedTools)) {
    return false;
  }

  if (input.wantedInputs !== undefined && !isStringArray(input.wantedInputs)) {
    return false;
  }

  if (
    input.confidence !== undefined &&
    input.confidence !== 'low' &&
    input.confidence !== 'medium' &&
    input.confidence !== 'high'
  ) {
    return false;
  }

  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
