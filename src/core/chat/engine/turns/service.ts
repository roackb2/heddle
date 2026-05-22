import { AgentLoopRuntimeService } from '@/core/runtime/loop/index.js';
import { FileConversationSessionService } from '@/core/chat/engine/sessions/service.js';
import type { NormalizedConversationEngineConfig } from '@/core/chat/engine/config.js';
import type {
  ClearConversationTurnLeaseInput,
  ContinueConversationTurnInput,
  ConversationSessionService,
  ConversationTurnService,
  SubmitConversationTurnInput,
  SubmitConversationTurnResult,
} from '@/core/chat/engine/types.js';
import { ConversationEngineHostNormalizer } from './host/index.js';
import { ConversationTurnContextBuilder } from './context/index.js';
import { ConversationTurnPreflightService } from './preflight/index.js';
import { ConversationTurnMemoryMaintenance } from './memory/index.js';
import type { TurnMemoryMaintenanceRuntimeInput } from './memory/index.js';
import { ConversationTurnPersistenceService } from './persistence/index.js';
import { ChatSessionLeases, type ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type { PrepareConversationTurnContextArgs } from './context/index.js';
import type { ChatTurnHostPort } from './host/index.js';
import type {
  RunConversationTurnArgs,
  RunConversationTurnResult,
  AgentLoopTurnInput,
  TurnPersistenceInput,
  TurnPreflightInput,
  TurnHostInput,
  TurnRuntimeConfigInput,
  TurnSubmitInput,
} from './types.js';

export class EngineConversationTurnService implements ConversationTurnService {
  private readonly sessions: ConversationSessionService;

  constructor(private readonly config: NormalizedConversationEngineConfig) {
    this.sessions = new FileConversationSessionService(config);
  }

  async submit(input: SubmitConversationTurnInput): Promise<SubmitConversationTurnResult> {
    const normalizedHost = ConversationEngineHostNormalizer.normalize(input.host);
    const runtimeConfigInput: TurnRuntimeConfigInput = this.config;
    const turnInput: TurnSubmitInput = input;
    return await EngineConversationTurnService.run({
      ...runtimeConfigInput,
      ...turnInput,
      ...EngineConversationTurnService.hostInput(normalizedHost, input),
      memoryMaintenanceMode: input.memoryMaintenanceMode ?? this.config.memoryMaintenanceMode,
      approvalPolicies: input.approvalPolicies ?? this.config.approvalPolicies,
      traceSummarizerRegistry: input.traceSummarizerRegistry ?? this.config.traceSummarizerRegistry,
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
    if (!this.sessions.read(input.sessionId)?.lease) {
      return;
    }

    this.sessions.releaseLease(input.sessionId, input.owner);
  }

  static async run(args: RunConversationTurnArgs): Promise<RunConversationTurnResult> {
    const contextInput: PrepareConversationTurnContextArgs = args;
    const context = ConversationTurnContextBuilder.build(contextInput);
    const { sessions, session, runtime, tools, toolNames, leaseOwner } = context;
    const host = EngineConversationTurnService.turnHost(args);
    const source = `chat session ${session.id}`;
    const preflightInput: TurnPreflightInput = args;
    const agentLoopInput: AgentLoopTurnInput = args;
    const persistenceInput: TurnPersistenceInput = args;
    const memoryRuntime: TurnMemoryMaintenanceRuntimeInput = {
      memoryRoot: runtime.memoryDir,
      llm: runtime.llm,
      source,
      onEvent: host.onEvent,
    };

    try {
      const preflight = await ConversationTurnPreflightService.prepare({
        ...preflightInput,
        sessionId: session.id,
        fallbackHistory: session.history,
        model: runtime.model,
        systemContext: runtime.systemContext,
        toolNames,
        summarizer: { credentialSource: runtime.providerCredentialSource },
        leaseOwner,
        sessions,
        host,
      });
      if (!preflight.ok) {
        throw new Error(preflight.message);
      }

      const result = await AgentLoopRuntimeService.run({
        ...agentLoopInput,
        goal: args.prompt,
        model: runtime.model,
        apiKey: runtime.apiKey,
        stateDir: args.stateRoot,
        memoryDir: runtime.memoryDir,
        llm: runtime.llm,
        tools,
        includeDefaultTools: false,
        history: preflight.compacted.history,
        systemContext: runtime.systemContext,
        onEvent: host.onEvent,
        approveToolCall: host.approveToolCall,
      });
      const maintenanceMode = args.memoryMaintenanceMode ?? 'background';
      const resultForPersistence =
        maintenanceMode === 'inline'
          ? await ConversationTurnMemoryMaintenance.runInline({
              ...memoryRuntime,
              result,
            })
          : result;

      const persisted = await ConversationTurnPersistenceService.persistCompleted({
        ...persistenceInput,
        result: resultForPersistence,
        session: preflight.session ?? session,
        sessions,
        model: runtime.model,
        systemContext: runtime.systemContext,
        toolNames,
        historyForTokenEstimate: session.history,
        credentialSource: runtime.providerCredentialSource,
        host,
      });

      if (maintenanceMode === 'background') {
        ConversationTurnMemoryMaintenance.scheduleBackground({
          ...memoryRuntime,
          trace: result.trace,
          traceFile: persisted.traceFile,
          sessionStoragePath: args.sessionStoragePath,
          sessionId: session.id,
          runId: result.state?.runId ?? `session-${session.id}`,
        });
      }

      return {
        outcome: resultForPersistence.outcome,
        summary: persisted.summary,
        session: persisted.session,
      };
    } finally {
      EngineConversationTurnService.clearLeaseFromStorage(args.sessionStoragePath, session.id, leaseOwner);
    }
  }

  static clearLeaseFromStorage(sessionStoragePath: string, sessionId: string, owner: ChatSessionLeaseOwner): void {
    const repository = new FileChatSessionRepository({ sessionStoragePath });
    const sessions = repository.list(true);
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session?.lease) {
      return;
    }

    const released = ChatSessionLeases.release(session, owner);
    if (released === session) {
      return;
    }

    repository.save(sessions.map((candidate) => (
      candidate.id === sessionId ? ChatSessionRecords.touch(released) : candidate
    )));
  }

  private static hostInput(
    normalizedHost: ReturnType<typeof ConversationEngineHostNormalizer.normalize>,
    input: SubmitConversationTurnInput,
  ): TurnHostInput {
    return {
      host: normalizedHost.turnHost,
      onTraceEvent: normalizedHost.onTraceEvent,
      shouldStop: input.shouldStop,
    };
  }

  private static turnHost(args: Pick<RunConversationTurnArgs, 'host' | 'onCompactionStatus'>): ChatTurnHostPort {
    if (!args.onCompactionStatus) {
      return args.host ?? {};
    }

    return {
      ...args.host,
      onCompactionStatus: (event, phase) => {
        args.onCompactionStatus?.(event);
        args.host?.onCompactionStatus?.(event, phase);
      },
    };
  }
}
