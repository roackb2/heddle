import { resolve } from 'node:path';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { HeddleEventType } from '@/core/event-types.js';
import { AgentRunService } from '@/core/agent/index.js';
import type { AgentRunEvent } from '@/core/agent/index.js';
import { AgentSkillsRuntimeContextService } from '@/core/skills/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import type { LlmAdapter, LlmRuntimeContext, ReasoningEffort } from '@/core/llm/types.js';
import type { ToolDefinition } from '@/core/types.js';
import { createLogger } from '@/core/utils/logger.js';
import type {
  ProviderCredentialSource,
  ResolvedProviderCredential,
} from '../credentials/index.js';
import { LlmProviderRuntimeService } from '../provider-runtime/index.js';
import { RuntimeToolService } from '../tools/index.js';
import { AgentLoopCheckpointService } from './checkpoint.js';
import type { AgentLoopResult, RunAgentLoopOptions } from './types.js';

/**
 * Main programmatic runtime boundary for one evented agent loop execution.
 */
export class AgentLoopRuntimeService {
  static async run(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
    const runId = AgentLoopCheckpointService.generateRunId();
    const model = options.model ?? options.llm?.info?.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
    const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    const credentialStorePath = this.resolveCredentialStorePath({ workspaceRoot, stateDir: options.stateDir });
    const providerRuntime = LlmProviderRuntimeService.resolve({
      model,
      apiKey: options.apiKey,
      credential: options.credential,
      credentialStorePath,
      reasoningEffort: options.reasoningEffort,
    });
    if (!options.llm) {
      LlmProviderRuntimeService.assertRunnable(providerRuntime);
    }
    const apiKey = options.apiKey ?? providerRuntime.apiKey;
    const llm = options.llm ?? await this.createLoopLlmAdapter({
      model,
      apiKey,
      credential: providerRuntime.credential,
      credentialStorePath,
      reasoningEffort: options.reasoningEffort,
      runtime: providerRuntime.llmRuntime,
    });
    const logger = options.logger ?? createLogger({ pretty: false, level: 'info', console: false });
    const tools = this.resolveTools(options, {
      model,
      apiKey,
      credential: providerRuntime.credential,
      providerCredentialSource: providerRuntime.credentialSource,
      workspaceRoot,
      credentialStorePath,
    });
    const systemContext = await this.resolveSystemContext({
      options,
      tools,
      workspaceRoot,
    });
    const now = () => new Date().toISOString();
    const startedAt = now();

    logger.info({
      model,
      provider: providerRuntime.provider,
      credentialSource: providerRuntime.credentialSource.type,
      credentialProvider: 'provider' in providerRuntime.credentialSource ? providerRuntime.credentialSource.provider : undefined,
    }, 'Agent runtime configured');

    const resumeMetadata = AgentLoopCheckpointService.resolveResumeMetadata(options.resumeFrom);

    options.onEvent?.({
      source: 'agent-loop',
      type: HeddleEventType.loopStarted,
      runId,
      goal: options.goal,
      model,
      provider: providerRuntime.provider,
      workspaceRoot,
      resumedFromCheckpoint: resumeMetadata?.checkpointRunId,
      timestamp: startedAt,
    });

    if (resumeMetadata) {
      options.onEvent?.({
        type: HeddleEventType.loopResumed,
        runId,
        fromCheckpoint: resumeMetadata.checkpointRunId,
        priorTraceEvents: resumeMetadata.priorTraceEvents,
        timestamp: now(),
      });
    }

    const result = await AgentRunService.run({
      goal: options.goal,
      llm,
      tools,
      workspaceRoot,
      maxSteps: options.maxSteps,
      maxToolConcurrency: options.maxToolConcurrency,
      logger,
      history: AgentLoopCheckpointService.resolveHistory(options),
      systemContext,
      onEvent: (event) => {
        AgentLoopRuntimeService.emitAgentRunEvent({ event, runId, now, options });
      },
      approvalPolicies: options.approvalPolicies,
      approveToolCall: options.approveToolCall,
      shouldStop: options.shouldStop,
      abortSignal: options.abortSignal,
    });

    const finishedAt = now();
    const state = AgentLoopCheckpointService.createFinishedState({
      runId,
      goal: options.goal,
      model,
      provider: providerRuntime.provider,
      workspaceRoot,
      startedAt,
      finishedAt,
      result,
    });

    options.onEvent?.({
      source: 'agent-loop',
      type: HeddleEventType.loopFinished,
      runId,
      outcome: result.outcome,
      summary: result.summary,
      ...(result.failure ? { failure: result.failure } : {}),
      usage: result.usage,
      state,
      timestamp: finishedAt,
    });

    return {
      ...result,
      model,
      provider: providerRuntime.provider,
      workspaceRoot,
      state,
    };
  }

  private static emitAgentRunEvent(args: {
    event: AgentRunEvent;
    runId: string;
    now: () => string;
    options: RunAgentLoopOptions;
  }): void {
    const { event, runId, now, options } = args;
    if (event.type === HeddleEventType.trace) {
      options.onEvent?.({ type: HeddleEventType.trace, runId, event: event.event, timestamp: now() });
      options.onTraceEvent?.(event.event);
      return;
    }

    options.onEvent?.({ source: 'agent-loop', ...event, runId, timestamp: now() });
  }

  private static resolveCredentialStorePath(args: {
    workspaceRoot: string;
    stateDir?: string;
  }): string | undefined {
    return args.stateDir
      ? ProviderCredentialRepository.resolveStorePath(resolve(args.workspaceRoot, args.stateDir))
      : undefined;
  }

  private static async createLoopLlmAdapter(options: {
    model: string;
    apiKey?: string;
    credential?: ResolvedProviderCredential;
    credentialStorePath?: string;
    reasoningEffort?: ReasoningEffort;
    runtime: LlmRuntimeContext;
  }): Promise<LlmAdapter> {
    return LlmAdapterService.create({
      model: options.model,
      credentials: {
        apiKey: options.apiKey,
        credential: options.credential,
        credentialStorePath: options.credentialStorePath,
      },
      runtime: {
        ...options.runtime,
        reasoningEffort: options.reasoningEffort,
      },
    });
  }

  private static resolveTools(
    options: RunAgentLoopOptions,
    runtime: {
      model: string;
      apiKey?: string;
      credential?: ResolvedProviderCredential;
      providerCredentialSource?: ProviderCredentialSource;
      workspaceRoot: string;
      credentialStorePath?: string;
    },
  ): ToolDefinition[] {
    const providedTools = options.tools ?? [];
    const extraTools = options.extraTools ?? [];
    if (options.includeDefaultTools === false) {
      return [...providedTools, ...extraTools];
    }

    return [
      ...RuntimeToolService.createDefaultAgentTools({
        model: runtime.model,
        apiKey: runtime.apiKey,
        credential: runtime.credential,
        providerCredentialSource: runtime.providerCredentialSource,
        credentialStorePath: runtime.credentialStorePath,
        workspaceRoot: runtime.workspaceRoot,
        stateDir: options.stateDir,
        stateRoot: this.resolveStateRoot(runtime.workspaceRoot, options.stateDir),
        memoryDir: options.memoryDir,
        searchIgnoreDirs: options.searchIgnoreDirs,
        includePlanTool: options.includePlanTool,
      }),
      ...providedTools,
      ...extraTools,
    ];
  }

  private static async resolveSystemContext(args: {
    options: RunAgentLoopOptions;
    tools: ToolDefinition[];
    workspaceRoot: string;
  }): Promise<string | undefined> {
    if (!args.tools.some((tool) => tool.name === 'read_agent_skill')) {
      return args.options.systemContext;
    }

    return await AgentSkillsRuntimeContextService.appendActivatedCatalog({
      workspaceRoot: args.workspaceRoot,
      stateRoot: this.resolveStateRoot(args.workspaceRoot, args.options.stateDir),
      systemContext: args.options.systemContext,
      readToolName: 'read_agent_skill',
    });
  }

  private static resolveStateRoot(workspaceRoot: string, stateDir?: string): string {
    return resolve(workspaceRoot, stateDir ?? '.heddle');
  }
}
