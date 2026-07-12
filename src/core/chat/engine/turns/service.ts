import { AgentLoopRuntimeService } from '@/core/runtime/loop/index.js';
import { AutonomyPermissionModeService, ToolApprovalProfileService } from '@/core/approvals/index.js';
import { ArtifactService } from '@/core/artifacts/index.js';
import type { ArtifactRepository } from '@/core/artifacts/index.js';
import { HeddleEventType } from '@/core/event-types.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
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
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
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
import type { TraceEvent } from '@/core/types.js';

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
    // Resolve session persistence once for the whole turn; every inner service
    // receives this instance instead of re-deriving storage from paths.
    const sessionRepository = args.sessionRepository
      ?? new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath });
    const contextInput: PrepareConversationTurnContextArgs = { ...args, sessionRepository };
    const context = ConversationTurnContextBuilder.build(contextInput);
    const { sessions, session, runtime, tools, toolNames, leaseOwner, agentSnapshot } = context;
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
        sessionRepository,
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
        maxSteps: args.maxSteps ?? agentSnapshot?.runtime.maxSteps,
        history: preflight.compacted.history,
        systemContext: runtime.systemContext,
        onEvent: host.onEvent,
        approveToolCall: host.approveToolCall,
        approvalPolicies: ToolApprovalProfileService.compile({
          profile: agentSnapshot?.approvalProfile,
          autoProfile: agentSnapshot?.approvalProfile.preset === 'auto'
            ? AutonomyPermissionModeService.buildAutoProfile({
              trustedRoots: ProjectConfigService.read(args.workspaceRoot).autoTrustedRoots,
            })
            : undefined,
          basePolicies: args.approvalPolicies,
        }),
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
        sessionRepository,
        result: resultForPersistence,
        session: preflight.session ?? session,
        sessions,
        model: runtime.model,
        systemContext: runtime.systemContext,
        toolNames,
        historyForTokenEstimate: session.history,
        credentialSource: runtime.providerCredentialSource,
        host,
        agentSnapshot,
      });

      if (maintenanceMode === 'background') {
        ConversationTurnMemoryMaintenance.scheduleBackground({
          ...memoryRuntime,
          trace: result.trace,
          traceFile: persisted.traceFile,
          sessionRepository,
          sessionId: session.id,
          runId: result.state?.runId ?? `session-${session.id}`,
        });
      }

      return {
        outcome: resultForPersistence.outcome,
        summary: persisted.summary,
        ...(resultForPersistence.failure ? { failure: resultForPersistence.failure } : {}),
        session: persisted.session,
        traceFile: persisted.traceFile,
        artifacts: EngineConversationTurnService.listTurnArtifacts({
          artifactRoot: args.artifactRoot,
          artifactRepository: args.artifactRepository,
          artifactsEnabled: args.artifactsEnabled,
          sessionId: session.id,
        }),
        toolResults: EngineConversationTurnService.summarizeToolResults(resultForPersistence.trace),
      };
    } finally {
      EngineConversationTurnService.clearLeaseFromStorage(sessionRepository, session.id, leaseOwner);
    }
  }

  static clearLeaseFromStorage(repository: ChatSessionRepository, sessionId: string, owner: ChatSessionLeaseOwner): void {
    const sessions = repository.list();
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

  private static listTurnArtifacts(args: {
    artifactRoot: string;
    artifactRepository?: ArtifactRepository;
    artifactsEnabled: boolean;
    sessionId: string;
  }): RunConversationTurnResult['artifacts'] {
    return args.artifactsEnabled
      ? new ArtifactService({ artifactRoot: args.artifactRoot, repository: args.artifactRepository })
        .list({ sessionId: args.sessionId })
      : [];
  }

  private static summarizeToolResults(trace: TraceEvent[]): RunConversationTurnResult['toolResults'] {
    return trace
      .filter((event): event is Extract<TraceEvent, { type: typeof HeddleEventType.toolCompleted }> => (
        event.type === HeddleEventType.toolCompleted
      ))
      .map((event) => ({
        call: event.call,
        result: event.result,
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        step: event.step,
        timestamp: event.timestamp,
      }));
  }
}
