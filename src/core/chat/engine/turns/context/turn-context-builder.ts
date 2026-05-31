import { RuntimeToolService } from '@/core/runtime/tools/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import { ConversationTurnRuntimeResolver } from '../runtime/index.js';
import type {
  ConversationTurnContext,
  ConversationTurnToolContextArgs,
  ConversationTurnToolRuntimeArgs,
  PrepareConversationTurnContextArgs,
} from './types.js';
import type { ConversationTurnRuntimeConfig } from '../runtime/index.js';

/**
 * Builds the concrete runtime context needed before a persisted turn can run.
 */
export class ConversationTurnContextBuilder {
  static build(args: PrepareConversationTurnContextArgs): ConversationTurnContext {
    const sessions = new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath }).list();
    const session = sessions.find((candidate) => candidate.id === args.sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${args.sessionId}`);
    }

    const runtimeConfig: ConversationTurnRuntimeConfig = args;
    const runtime = ConversationTurnRuntimeResolver.resolve({ config: runtimeConfig, session });
    const toolContext: ConversationTurnToolContextArgs = args;
    const toolRuntime: ConversationTurnToolRuntimeArgs = runtime;
    const tools = RuntimeToolService.createDefaultAgentTools({
      ...toolContext,
      ...toolRuntime,
    });

    return {
      sessions,
      session,
      runtime,
      tools,
      toolNames: tools.map((tool) => tool.name),
      leaseOwner: args.leaseOwner ?? {
        ownerKind: 'ask',
        ownerId: `submit-${process.pid}`,
        clientLabel: 'another Heddle client',
      },
    };
  }
}
