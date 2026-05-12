import type { AwarenessCollectInput, AwarenessProvider } from '../../types.js';
import type { CodingAwarenessSnapshot } from './types.js';
import { collectCodingProjectDashboard } from './collectors/workspace.js';

export type CodingAwarenessProviderOptions = {
  now?: () => Date;
  nextId?: () => string;
};

export function createCodingAwarenessProvider(
  options: CodingAwarenessProviderOptions = {},
): AwarenessProvider<CodingAwarenessSnapshot['sections'][number]> {
  return {
    domain: 'coding',
    async collect(input: AwarenessCollectInput): Promise<CodingAwarenessSnapshot> {
      if (input.profile !== 'project_dashboard') {
        throw new Error(`Unsupported coding awareness profile: ${input.profile}`);
      }

      const collectedAt = (options.now ?? (() => new Date()))().toISOString();
      const id = (options.nextId ?? defaultNextId)();
      const collected = await collectCodingProjectDashboard(input);
      const requestedSections = new Set(input.requestedSections ?? ['working_environment', 'workspace_tree']);
      const sections: CodingAwarenessSnapshot['sections'] = [];

      if (requestedSections.has('working_environment')) {
        sections.push({
          type: 'working_environment',
          data: collected.environment,
        });
      }
      if (requestedSections.has('workspace_tree')) {
        sections.push({
          type: 'workspace_tree',
          data: collected.workspaceTree,
        });
      }

      return {
        id,
        domain: 'coding',
        profile: 'project_dashboard',
        collectedAt,
        workspaceRoot: input.workspaceRoot,
        sections,
        sources: collected.sources,
        limits: collected.limits,
      };
    },
  };
}

function defaultNextId(): string {
  return `awareness-${Math.random().toString(36).slice(2, 10)}`;
}
