import { resolve } from 'node:path';
import { resolveProviderCredentialStorePath } from '@/core/auth/provider-credentials.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { AgentRunService } from '@/core/agent/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import type { LlmAdapter, ReasoningEffort } from '@/core/llm/types.js';
import type { ToolDefinition } from '@/core/types.js';
import { createLogger } from '@/core/utils/logger.js';
import { RuntimeCredentialService } from '../credentials/index.js';
import type { ProviderCredentialSource } from '../credentials/index.js';
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
    const provider = LlmAdapterService.inferProvider(model);
    const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    const apiKey = options.apiKey ?? RuntimeCredentialService.resolveApiKeyForModel(model);
    const credentialStorePath = this.resolveCredentialStorePath({ workspaceRoot, stateDir: options.stateDir });
    const providerCredentialSource = RuntimeCredentialService.resolveCredentialSourceForModel(model, {
      apiKey,
      apiKeyProvider: options.apiKey ? 'explicit' : apiKey ? provider : undefined,
      credentialStorePath,
    });
    const llm = options.llm ?? await this.createLoopLlmAdapter({
      model,
      apiKey,
      credentialStorePath,
      reasoningEffort: options.reasoningEffort,
    });
    const logger = options.logger ?? createLogger({ pretty: false, level: 'info', console: false });
    const tools = this.resolveTools(options, {
      model,
      apiKey,
      providerCredentialSource,
      workspaceRoot,
      credentialStorePath,
    });
    const now = () => new Date().toISOString();
    const startedAt = now();

    logger.info({
      model,
      provider,
      credentialSource: providerCredentialSource.type,
      credentialProvider: 'provider' in providerCredentialSource ? providerCredentialSource.provider : undefined,
    }, 'Agent runtime configured');

    const resumeMetadata = AgentLoopCheckpointService.resolveResumeMetadata(options.resumeFrom);

    options.onEvent?.({
      type: 'loop.started',
      runId,
      goal: options.goal,
      model,
      provider,
      workspaceRoot,
      resumedFromCheckpoint: resumeMetadata?.checkpointRunId,
      timestamp: startedAt,
    });

    if (resumeMetadata) {
      options.onEvent?.({
        type: 'loop.resumed',
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
      logger,
      history: AgentLoopCheckpointService.resolveHistory(options),
      systemContext: options.systemContext,
      onAssistantStream: (update) => {
        options.onEvent?.({
          type: 'assistant.stream',
          runId,
          ...update,
          timestamp: now(),
        });
        options.onAssistantStream?.(update);
      },
      onEvent: (event) => {
        options.onEvent?.({ type: 'trace', runId, event, timestamp: now() });
        options.onTraceEvent?.(event);
      },
      onToolCalling: (call, step, toolDef) => {
        options.onEvent?.({
          type: 'tool.calling',
          runId,
          step,
          tool: call.tool,
          toolCallId: call.id,
          input: call.input,
          requiresApproval: toolDef.requiresApproval ?? false,
          timestamp: now(),
        });
      },
      onToolCompleted: (call, result, step, durationMs) => {
        options.onEvent?.({
          type: 'tool.completed',
          runId,
          step,
          tool: call.tool,
          toolCallId: call.id,
          result: { ok: result.ok, output: result.output, error: result.error },
          durationMs,
          timestamp: now(),
        });
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
      provider,
      workspaceRoot,
      startedAt,
      finishedAt,
      result,
    });

    options.onEvent?.({
      type: 'loop.finished',
      runId,
      outcome: result.outcome,
      summary: result.summary,
      usage: result.usage,
      state,
      timestamp: finishedAt,
    });

    return {
      ...result,
      model,
      provider,
      workspaceRoot,
      state,
    };
  }

  private static resolveCredentialStorePath(args: {
    workspaceRoot: string;
    stateDir?: string;
  }): string | undefined {
    return args.stateDir
      ? resolveProviderCredentialStorePath(resolve(args.workspaceRoot, args.stateDir))
      : undefined;
  }

  private static async createLoopLlmAdapter(options: {
    model: string;
    apiKey?: string;
    credentialStorePath?: string;
    reasoningEffort?: ReasoningEffort;
  }): Promise<LlmAdapter> {
    return LlmAdapterService.create({
      model: options.model,
      credentials: {
        apiKey: options.apiKey,
        credentialStorePath: options.credentialStorePath,
      },
      runtime: {
        reasoningEffort: options.reasoningEffort,
      },
    });
  }

  private static resolveTools(
    options: RunAgentLoopOptions,
    runtime: {
      model: string;
      apiKey?: string;
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
        providerCredentialSource: runtime.providerCredentialSource,
        credentialStorePath: runtime.credentialStorePath,
        workspaceRoot: runtime.workspaceRoot,
        stateDir: options.stateDir,
        memoryDir: options.memoryDir,
        searchIgnoreDirs: options.searchIgnoreDirs,
        includePlanTool: options.includePlanTool,
      }),
      ...providedTools,
      ...extraTools,
    ];
  }
}
