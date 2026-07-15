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
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
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
    const session = await this.sessions.require(input.sessionId);
    if (!input.prompt && (!session.history.length || !session.lastContinuePrompt)) {
      throw new Error('There is no interrupted or prior run to continue yet.');
    }

    return await this.submit({
      ...input,
      prompt: input.prompt ?? session.lastContinuePrompt ?? '',
    });
  }

  async clearLease(input: ClearConversationTurnLeaseInput): Promise<void> {
    if (!(await this.sessions.read(input.sessionId))?.lease) {
      return;
    }

    await this.sessions.releaseLease(input.sessionId, input.owner);
  }

  static async run(args: RunConversationTurnArgs): Promise<RunConversationTurnResult> {
    // Resolve session persistence once for the whole turn; every inner service
    // receives this instance instead of re-deriving storage from paths.
    const sessionRepository = args.sessionRepository
      ?? new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath });
    const sessionService = new FileConversationSessionService({
      workspaceRoot: args.workspaceRoot,
      stateRoot: args.stateRoot,
      sessionStoragePath: args.sessionStoragePath,
      sessionRepository,
    });
    const contextInput: PrepareConversationTurnContextArgs = { ...args, sessionService };
    const context = await ConversationTurnContextBuilder.build(contextInput);
    const { session, runtime, tools, toolNames, leaseOwner, agentSnapshot } = context;
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
        sessionService,
        sessionId: session.id,
        fallbackHistory: session.history,
        model: runtime.model,
        systemContext: runtime.systemContext,
        toolNames,
        summarizer: { credentialSource: runtime.providerCredentialSource },
        leaseOwner,
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
        sessionService,
        result: resultForPersistence,
        session: preflight.session ?? session,
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
          sessionService,
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
      await EngineConversationTurnService.clearLeaseFromStorage(sessionService, session.id, leaseOwner);
    }
  }

  static async clearLeaseFromStorage(
    sessions: ConversationSessionService,
    sessionId: string,
    owner: ChatSessionLeaseOwner,
  ): Promise<void> {
    const session = await sessions.read(sessionId);
    if (!session?.lease) {
      return;
    }

    await sessions.releaseLease(sessionId, owner);
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
