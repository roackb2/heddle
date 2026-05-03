import { runConversationTurn, clearConversationTurnLease } from '../conversation-turn.js';
import { readChatSession } from '../storage.js';
import type { ConversationEngineConfig, ConversationTurnService } from './types.js';
import type { ConversationEnginePaths } from './paths.js';
import { normalizeConversationEngineHost } from './host.js';

export function createConversationTurnService(args: {
  config: ConversationEngineConfig;
  paths: ConversationEnginePaths;
}): ConversationTurnService {
  const { config, paths } = args;

  return {
    async submit(input) {
      const normalizedHost = normalizeConversationEngineHost(input.host);
      return await runConversationTurn({
        workspaceRoot: paths.workspaceRoot,
        stateRoot: paths.stateRoot,
        sessionStoragePath: paths.sessionStoragePath,
        sessionId: input.sessionId,
        prompt: input.prompt,
        apiKey: config.apiKey,
        preferApiKey: config.preferApiKey,
        credentialStorePath: paths.credentialStorePath,
        systemContext: config.systemContext,
        memoryMaintenanceMode: input.memoryMaintenanceMode ?? config.memoryMaintenanceMode,
        host: normalizedHost.turnHost,
        approvalPolicies: input.approvalPolicies ?? config.approvalPolicies,
        traceSummarizerRegistry: input.traceSummarizerRegistry ?? config.traceSummarizerRegistry,
        onCompactionStatus: normalizedHost.onCompactionStatus,
        onAssistantStream: normalizedHost.onAssistantStream,
        onTraceEvent: normalizedHost.onTraceEvent,
        abortSignal: input.abortSignal,
        leaseOwner: input.leaseOwner,
      });
    },
    async continue(input) {
      const session = readChatSession(paths.sessionStoragePath, input.sessionId, config.apiKeyPresent ?? Boolean(config.apiKey));
      if (!session) {
        throw new Error(`Chat session not found: ${input.sessionId}`);
      }
      if (!input.prompt && (!session.history.length || !session.lastContinuePrompt)) {
        throw new Error('There is no interrupted or prior run to continue yet.');
      }

      return await this.submit({
        ...input,
        prompt: input.prompt ?? session.lastContinuePrompt ?? '',
      });
    },
    clearLease(input) {
      clearConversationTurnLease(paths.sessionStoragePath, input.sessionId, input.owner);
    },
  };
}
