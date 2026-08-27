import { AgentLoopRuntimeService } from '@/core/runtime/loop/index.js';
import { AutonomyPermissionModeService, ToolApprovalProfileService } from '@/core/approvals/index.js';
import { ArtifactService } from '@/core/artifacts/index.js';
import type { ArtifactRepository } from '@/core/artifacts/index.js';
import { HeddleEventType } from '@/core/event-types.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
import {
  DelegationService,
  type DelegationRootScope,
} from '@/core/delegation/index.js';
import { ConversationDelegationPolicyService } from '@/core/chat/engine/delegation-policy.js';
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
import { ConversationTurnContextRecoveryService } from './recovery/index.js';
import { ConversationTurnMemoryMaintenance } from './memory/index.js';
import type { TurnMemoryMaintenanceRuntimeInput } from './memory/index.js';
import { ConversationTurnLeaseHeartbeatService } from './lease/index.js';
import { ConversationTurnPersistenceService } from './persistence/index.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type {
  ConversationTurnContext,
  PrepareConversationTurnContextArgs,
} from './context/index.js';
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
    const {
      session,
      runtime,
      tools,
      leaseOwner,
      agentSnapshot,
    } = context;
    const delegationScope = EngineConversationTurnService.createDelegationScope(args, context);
    const rootTools = delegationScope
      ? [...tools, delegationScope.createTool()]
      : tools;
    const toolNames = rootTools.map((tool) => tool.name);
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
    const leaseHeartbeat = new ConversationTurnLeaseHeartbeatService({
      sessionService,
      sessionId: session.id,
    });
    const abortSignal = args.abortSignal
      ? AbortSignal.any([args.abortSignal, leaseHeartbeat.signal])
      : leaseHeartbeat.signal;

    try {
      const preflight = await ConversationTurnPreflightService.prepare({
        ...preflightInput,
        sessionService,
        sessionId: session.id,
        fallbackHistory: session.history,
        model: runtime.model,
        systemContext: runtime.systemContext,
        toolNames,
        summarizer: runtime.summarizer,
        leaseOwner,
        onLeaseAcquired: (claim) => leaseHeartbeat.start(claim),
        host,
      });
      if (!preflight.ok) {
        throw new Error(preflight.message);
      }
      leaseHeartbeat.throwIfFailed();

      const result = await AgentLoopRuntimeService.run({
        ...agentLoopInput,
        runId: delegationScope?.rootRunId,
        goal: args.prompt,
        model: runtime.model,
        apiKey: runtime.apiKey,
        credential: runtime.credential?.type === 'oauth-access-token' ? runtime.credential : undefined,
        stateDir: args.stateRoot,
        memoryDir: runtime.memoryDir,
        llm: runtime.llm,
        tools: rootTools,
        includeDefaultTools: false,
        maxSteps: args.maxSteps ?? agentSnapshot?.runtime.maxSteps,
        maxToolConcurrency: args.maxToolConcurrency,
        history: preflight.compacted.history,
        systemContext: runtime.systemContext,
        abortSignal,
        shouldStop: () => leaseHeartbeat.signal.aborted || args.shouldStop?.() === true,
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
        recoverModelContext: async (input) => {
          leaseHeartbeat.throwIfFailed();
          const recovered = await ConversationTurnContextRecoveryService.recover({
            ...input,
            sessionService,
            sessionId: session.id,
            leaseClaim: preflight.leaseClaim,
            model: runtime.model,
            stateRoot: args.stateRoot,
            archiveRepository: args.archiveRepository,
            systemContext: runtime.systemContext,
            toolNames,
            prompt: args.prompt,
            summarizer: runtime.summarizer,
            host,
          });
          leaseHeartbeat.throwIfFailed();
          return recovered;
        },
      }).catch((error: unknown) => {
        leaseHeartbeat.throwIfFailed();
        throw error;
      });
      leaseHeartbeat.throwIfFailed();
      const maintenanceMode = args.memoryMaintenanceMode ?? 'background';
      const resultForPersistence =
        maintenanceMode === 'inline'
          ? await ConversationTurnMemoryMaintenance.runInline({
              ...memoryRuntime,
              result,
            })
          : result;
      leaseHeartbeat.throwIfFailed();

      const persisted = await ConversationTurnPersistenceService.persistCompleted({
        ...persistenceInput,
        sessionService,
        result: resultForPersistence,
        session: preflight.session ?? session,
        model: runtime.model,
        systemContext: runtime.systemContext,
        toolNames,
        historyForTokenEstimate: session.history,
        summarizer: runtime.summarizer,
        host,
        agentSnapshot,
        leaseClaim: preflight.leaseClaim,
      });
      await leaseHeartbeat.stop();
      leaseHeartbeat.throwIfFailed();

      if (maintenanceMode === 'background') {
        await ConversationTurnMemoryMaintenance.runBackground({
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
        ...(delegationScope ? { delegation: delegationScope.snapshot() } : {}),
        memory: {
          // Background maintenance runs after the primary turn is persisted,
          // but the result does not resolve until that working copy is stable.
          changed: resultForPersistence.trace.some(
            ({ type }) => type === HeddleEventType.memoryCandidateRecorded,
          ),
        },
      };
    } finally {
      await delegationScope?.cancelAndWait();
      await leaseHeartbeat.stop();
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

  /**
   * Composes the conversation-owned activation rule with the lower-level
   * delegation runtime. Engine policy is the authority ceiling; a turn may
   * turn delegation off but cannot re-enable a host-disabled engine.
   */
  private static createDelegationScope(
    args: RunConversationTurnArgs,
    context: ConversationTurnContext,
  ): DelegationRootScope | undefined {
    const policy = args.delegationPolicy
      ?? ConversationDelegationPolicyService.resolveEnginePolicy(undefined);
    if (!ConversationDelegationPolicyService.isEnabled({
      enginePolicy: policy,
      turnMode: args.delegation,
    })) {
      return undefined;
    }
    if (context.tools.some((tool) => tool.name === 'delegate_task')) {
      throw new Error('delegate_task is reserved by the conversation delegation runtime');
    }

    return new DelegationService({ policy }).createRootScope({
      workspaceRoot: args.workspaceRoot,
      runtime: {
        model: context.runtime.model,
        reasoningEffort: context.runtime.reasoningEffort,
        apiKey: context.runtime.apiKey,
        credential: context.runtime.credential?.type === 'oauth-access-token'
          ? context.runtime.credential
          : undefined,
        preferApiKey: args.preferApiKey,
        maxToolConcurrency: args.maxToolConcurrency,
        stateDir: args.stateRoot,
        memoryDir: context.runtime.memoryDir,
        searchIgnoreDirs: args.searchIgnoreDirs,
        baseSystemContext: context.baseSystemContext,
        createChildLlm: () => context.runtime.createLlm(),
      },
    });
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
