import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createConversationEngine } from '../../../src/index.js';
import { HostedAgentService } from './agent-service.js';

export const EXAMPLE_ACCOUNT_ID = 'local-example-account';

/**
 * Composition root for the runnable examples. A real host would usually
 * resolve credentials and repositories from its own account/container scope.
 */
export function createExampleHostedAgentService(): HostedAgentService {
  const workspaceRoot = process.cwd();
  const exampleStateRoot = join(workspaceRoot, '.heddle', 'examples', 'hosted-agent');

  return new HostedAgentService({
    createEngine: ({ accountId }) => createConversationEngine({
      workspaceRoot,
      stateRoot: join(exampleStateRoot, accountStorageKey(accountId)),
      model: process.env.HEDDLE_EXAMPLE_MODEL ?? process.env.HEDDLE_MODEL ?? 'gpt-5.4',
      systemContext: 'You are a conversational assistant embedded in a TypeScript product.',
      memoryMaintenanceMode: 'none',
      toolProfile: {
        preset: 'inspect',
        memoryMode: 'none',
      },
    }),
    createHost: () => ({
      approvals: {
        requestToolApproval: async ({ call }) => ({
          approved: false,
          reason: `The hosted example does not approve ${call.tool}. Inject your product policy here.`,
        }),
      },
    }),
  });
}

function accountStorageKey(accountId: string): string {
  return createHash('sha256').update(accountId).digest('hex');
}
