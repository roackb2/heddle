import { runConversationTurn, clearConversationTurnLease } from './run-conversation-turn.js';
import { readChatSession } from '../sessions/storage.js';
import type { NormalizedConversationEngineConfig } from '../config.js';
import type {
  ContinueConversationTurnInput,
  ConversationTurnService,
  SubmitConversationTurnInput,
} from '../types.js';
import { normalizeConversationEngineHost } from './host.js';

export function createConversationTurnService(args: {
  config: NormalizedConversationEngineConfig;
}): ConversationTurnService {
  const { config } = args;

  async function submit(input: SubmitConversationTurnInput) {
    const normalizedHost = normalizeConversationEngineHost(input.host);
    return await runConversationTurn({
      workspaceRoot: config.workspaceRoot,
      stateRoot: config.stateRoot,
      sessionStoragePath: config.sessionStoragePath,
      sessionId: input.sessionId,
      prompt: input.prompt,
      apiKey: config.apiKey,
      preferApiKey: config.preferApiKey,
      credentialStorePath: config.credentialStorePath,
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
      traceDir: config.traceDir,
    });
  }

  async function continueTurn(input: ContinueConversationTurnInput) {
    const session = readChatSession(config.sessionStoragePath, input.sessionId, config.apiKeyPresent);
    if (!session) {
      throw new Error(`Chat session not found: ${input.sessionId}`);
    }
    if (!input.prompt && (!session.history.length || !session.lastContinuePrompt)) {
      throw new Error('There is no interrupted or prior run to continue yet.');
    }

    return await submit({
      ...input,
      prompt: input.prompt ?? session.lastContinuePrompt ?? '',
    });
  }

  return {
    submit,
    continue: continueTurn,
    clearLease(input) {
      clearConversationTurnLease(config.sessionStoragePath, input.sessionId, input.owner);
    },
  };
}
