import { RuntimeToolService } from '@/core/runtime/tools/index.js';
import { CustomAgentRuntimeContextService } from '@/core/custom-agents/index.js';
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
  static async build(args: PrepareConversationTurnContextArgs): Promise<ConversationTurnContext> {
    const session = await args.sessionService.require(args.sessionId);

    const runtimeConfig: ConversationTurnRuntimeConfig = args;
    const baseRuntime = ConversationTurnRuntimeResolver.resolve({ config: runtimeConfig, session });
    const runtime = {
      ...baseRuntime,
      systemContext: CustomAgentRuntimeContextService.appendAgentInstructions({
        systemContext: baseRuntime.systemContext,
        snapshot: args.agentSnapshot,
      }),
    };
    const toolContext: ConversationTurnToolContextArgs = args;
    const toolRuntime: ConversationTurnToolRuntimeArgs = runtime;
    const toolProfile = args.agentSnapshot?.toolProfile ?? args.toolProfile;
    const tools = RuntimeToolService.createDefaultAgentTools({
      ...toolContext,
      ...toolRuntime,
      stateRoot: args.stateRoot,
      sessionId: session.id,
      memoryMode: toolProfile?.memoryMode,
      toolProfile,
    });

    return {
      session,
      runtime,
      agentSnapshot: args.agentSnapshot,
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
