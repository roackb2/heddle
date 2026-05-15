import { runConversationTurn, clearConversationTurnLease } from './run-conversation-turn.js';
import { FileConversationSessionService } from '../sessions/service.js';
import type { NormalizedConversationEngineConfig } from '../config.js';
import type {
  ClearConversationTurnLeaseInput,
  ContinueConversationTurnInput,
  ConversationSessionService,
  ConversationTurnService,
  SubmitConversationTurnInput,
  SubmitConversationTurnResult,
} from '../types.js';
import { normalizeConversationEngineHost } from './host.js';

export class EngineConversationTurnService implements ConversationTurnService {
  private readonly sessions: ConversationSessionService;

  constructor(private readonly config: NormalizedConversationEngineConfig) {
    this.sessions = new FileConversationSessionService(config);
  }

  async submit(input: SubmitConversationTurnInput): Promise<SubmitConversationTurnResult> {
    const normalizedHost = normalizeConversationEngineHost(input.host);
    return await runConversationTurn({
      workspaceRoot: this.config.workspaceRoot,
      stateRoot: this.config.stateRoot,
      sessionStoragePath: this.config.sessionStoragePath,
      sessionId: input.sessionId,
      prompt: input.prompt,
      maxSteps: input.maxSteps,
      searchIgnoreDirs: input.searchIgnoreDirs,
      includePlanTool: input.includePlanTool,
      apiKey: this.config.apiKey,
      preferApiKey: this.config.preferApiKey,
      credentialStorePath: this.config.credentialStorePath,
      systemContext: this.config.systemContext,
      memoryMaintenanceMode: input.memoryMaintenanceMode ?? this.config.memoryMaintenanceMode,
      host: normalizedHost.turnHost,
      approvalPolicies: input.approvalPolicies ?? this.config.approvalPolicies,
      traceSummarizerRegistry: input.traceSummarizerRegistry ?? this.config.traceSummarizerRegistry,
      onCompactionStatus: normalizedHost.onCompactionStatus,
      onAssistantStream: normalizedHost.onAssistantStream,
      onTraceEvent: normalizedHost.onTraceEvent,
      abortSignal: input.abortSignal,
      leaseOwner: input.leaseOwner,
      traceDir: this.config.traceDir,
    });
  }

  async continue(input: ContinueConversationTurnInput): Promise<SubmitConversationTurnResult> {
    const session = this.sessions.require(input.sessionId);
    if (!input.prompt && (!session.history.length || !session.lastContinuePrompt)) {
      throw new Error('There is no interrupted or prior run to continue yet.');
    }

    return await this.submit({
      ...input,
      prompt: input.prompt ?? session.lastContinuePrompt ?? '',
    });
  }

  clearLease(input: ClearConversationTurnLeaseInput): void {
    clearConversationTurnLease(this.config.sessionStoragePath, input.sessionId, input.owner);
  }
}
