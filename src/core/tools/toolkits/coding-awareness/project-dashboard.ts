import type { ToolDefinition, ToolResult } from '../../../types.js';
import { createAwarenessService } from '../../../awareness/service.js';
import { createCodingAwarenessProvider } from '../../../awareness/domains/coding/provider.js';
import { formatCodingProjectDashboardSnapshot } from '../../../awareness/domains/coding/format.js';
import type { CodingAwarenessSnapshot } from '../../../awareness/domains/coding/types.js';

const ALLOWED_SECTIONS = new Set(['working_environment', 'workspace_tree']);
const MAX_ALLOWED_DEPTH = 4;
const MAX_ALLOWED_ENTRIES = 200;

type ProjectDashboardInput = {
  includeSections?: Array<'working_environment' | 'workspace_tree'>;
  maxDepth?: number;
  maxEntries?: number;
};

export type ProjectDashboardToolOptions = {
  workspaceRoot?: string;
};

export function createProjectDashboardTool(options: ProjectDashboardToolOptions = {}): ToolDefinition {
  const configuredWorkspaceRoot = options.workspaceRoot ?? process.cwd();
  const awarenessService = createAwarenessService({
    providers: [createCodingAwarenessProvider()],
  });

  return {
    name: 'project_dashboard',
    description:
      'Collect the initial coding project dashboard for the active workspace. Default output includes current working-environment state and a bounded workspace tree in one structured result, so you can orient in a single call before substantial coding, planning, or review work. Use this first, then follow with read_file or search_files only for task-specific details. Optional fields include includeSections, maxDepth, and maxEntries when you intentionally want a smaller dashboard.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        includeSections: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['working_environment', 'workspace_tree'],
          },
        },
        maxDepth: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_ALLOWED_DEPTH,
        },
        maxEntries: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_ALLOWED_ENTRIES,
        },
      },
    },
    async execute(raw: unknown): Promise<ToolResult> {
      const input = validateProjectDashboardInput(raw);
      if ('error' in input) {
        return {
          ok: false,
          error: input.error,
        };
      }

      const snapshot = await awarenessService.collect({
        domain: 'coding',
        profile: 'project_dashboard',
        workspaceRoot: configuredWorkspaceRoot,
        requestedSections: input.value.includeSections,
        maxDepth: input.value.maxDepth,
        maxEntries: input.value.maxEntries,
      }) as CodingAwarenessSnapshot;

      return {
        ok: true,
        output: formatCodingProjectDashboardSnapshot(snapshot),
      };
    },
  };
}

export const projectDashboardTool: ToolDefinition = createProjectDashboardTool();

function validateProjectDashboardInput(
  raw: unknown,
): { value: ProjectDashboardInput } | { error: string } {
  if (raw == null) {
    return { value: {} };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: invalidProjectDashboardInput() };
  }

  const value = raw as Record<string, unknown>;
  const allowedKeys = new Set(['includeSections', 'maxDepth', 'maxEntries']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      return { error: invalidProjectDashboardInput() };
    }
  }

  if (value.includeSections !== undefined) {
    if (!Array.isArray(value.includeSections) || value.includeSections.length === 0) {
      return { error: invalidProjectDashboardInput() };
    }
    for (const section of value.includeSections) {
      if (typeof section !== 'string' || !ALLOWED_SECTIONS.has(section)) {
        return { error: invalidProjectDashboardInput() };
      }
    }
  }

  if (value.maxDepth !== undefined && !isBoundedPositiveInteger(value.maxDepth, MAX_ALLOWED_DEPTH)) {
    return { error: invalidProjectDashboardInput() };
  }

  if (value.maxEntries !== undefined && !isBoundedPositiveInteger(value.maxEntries, MAX_ALLOWED_ENTRIES)) {
    return { error: invalidProjectDashboardInput() };
  }

  return {
    value: {
      includeSections: value.includeSections as ProjectDashboardInput['includeSections'] | undefined,
      maxDepth: value.maxDepth as number | undefined,
      maxEntries: value.maxEntries as number | undefined,
    },
  };
}

function isBoundedPositiveInteger(value: unknown, max: number): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= max;
}

function invalidProjectDashboardInput(): string {
  return 'Invalid input for project_dashboard. Optional fields: includeSections (working_environment|workspace_tree), maxDepth (1-4), maxEntries (1-200). Use {} for the default full dashboard.';
}
