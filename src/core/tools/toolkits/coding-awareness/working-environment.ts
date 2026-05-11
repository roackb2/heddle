import type { ToolDefinition, ToolResult } from '../../../types.js';
import { createAwarenessService } from '../../../awareness/service.js';
import { createCodingAwarenessProvider } from '../../../awareness/domains/coding/provider.js';
import { formatCodingWorkingEnvironmentSnapshot } from '../../../awareness/domains/coding/format.js';
import type { CodingAwarenessSnapshot } from '../../../awareness/domains/coding/types.js';

type WorkingEnvironmentInput = Record<string, never>;

export type WorkingEnvironmentToolOptions = {
  workspaceRoot?: string;
};

export function createWorkingEnvironmentTool(options: WorkingEnvironmentToolOptions = {}): ToolDefinition {
  const configuredWorkspaceRoot = options.workspaceRoot ?? process.cwd();
  const awarenessService = createAwarenessService({
    providers: [createCodingAwarenessProvider()],
  });

  return {
    name: 'working_environment',
    description:
      'Collect a compact coding working-environment summary for the active workspace. Use this before substantial coding work when you need workspace root, git repo root, branch, short commit, and current dirty/staged/untracked/deleted/renamed paths without reconstructing them manually. This tool summarizes metadata and paths only, excludes Heddle runtime state such as .heddle, degrades gracefully outside git repos, and reports freshness plus collection limits.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isWorkingEnvironmentInput(raw)) {
        return {
          ok: false,
          error: 'Invalid input for working_environment. This tool takes no input; use {}.',
        };
      }

      const snapshot = await awarenessService.collect<CodingAwarenessSnapshot['sections'][number]>({
        domain: 'coding',
        profile: 'working_environment',
        workspaceRoot: configuredWorkspaceRoot,
      }) as CodingAwarenessSnapshot;

      return {
        ok: true,
        output: formatCodingWorkingEnvironmentSnapshot(snapshot),
      };
    },
  };
}

export const workingEnvironmentTool: ToolDefinition = createWorkingEnvironmentTool();

function isWorkingEnvironmentInput(raw: unknown): raw is WorkingEnvironmentInput {
  if (raw == null) {
    return true;
  }

  return typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0;
}
