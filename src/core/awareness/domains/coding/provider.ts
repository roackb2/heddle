import type { AwarenessCollectInput, AwarenessProvider } from '../../types.js';
import type { CodingAwarenessSnapshot } from './types.js';
import { collectCodingWorkingEnvironment } from './collectors/workspace.js';

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
      if (input.profile !== 'working_environment') {
        throw new Error(`Unsupported coding awareness profile: ${input.profile}`);
      }

      const collectedAt = (options.now ?? (() => new Date()))().toISOString();
      const id = (options.nextId ?? defaultNextId)();
      const collected = await collectCodingWorkingEnvironment(input);

      return {
        id,
        domain: 'coding',
        profile: 'working_environment',
        collectedAt,
        workspaceRoot: input.workspaceRoot,
        sections: [{
          type: 'working_environment',
          data: collected.environment,
        }],
        sources: collected.sources,
        limits: collected.limits,
      };
    },
  };
}

function defaultNextId(): string {
  return `awareness-${Math.random().toString(36).slice(2, 10)}`;
}
