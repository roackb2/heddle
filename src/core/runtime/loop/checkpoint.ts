import type { ChatMessage, LlmProvider } from '@/core/llm/types.js';
import type { RunResult } from '@/core/types.js';
import type { AgentLoopCheckpoint, AgentLoopState } from './types.js';

/**
 * Owns agent-loop state snapshots and checkpoint conversion.
 */
export class AgentLoopCheckpointService {
  static readonly MAX_RUN_ID_LENGTH = 128;

  static createFinishedState(args: {
    runId: string;
    goal: string;
    model: string;
    provider: LlmProvider;
    workspaceRoot: string;
    startedAt: string;
    finishedAt: string;
    result: RunResult;
  }): AgentLoopState {
    return {
      status: 'finished',
      runId: args.runId,
      goal: args.goal,
      model: args.model,
      provider: args.provider,
      workspaceRoot: args.workspaceRoot,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      outcome: args.result.outcome,
      summary: args.result.summary,
      ...(args.result.failure ? { failure: args.result.failure } : {}),
      usage: args.result.usage,
      transcript: args.result.transcript,
      trace: args.result.trace,
    };
  }

  static createCheckpoint(
    state: AgentLoopState,
    options: { createdAt?: string } = {},
  ): AgentLoopCheckpoint {
    return {
      version: 1,
      runId: state.runId,
      createdAt: options.createdAt ?? new Date().toISOString(),
      state,
    };
  }

  static generateRunId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 6);
    return `run_${timestamp}_${random}`;
  }

  static resolveRunId(runId: string | undefined): string {
    if (runId === undefined) {
      return this.generateRunId();
    }

    if (
      !runId.trim()
      || runId !== runId.trim()
      || runId.length > this.MAX_RUN_ID_LENGTH
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(runId)
    ) {
      throw new Error(
        `runId must start with an alphanumeric character, contain only letters, numbers, ., _, :, or -, and be at most ${this.MAX_RUN_ID_LENGTH} characters`,
      );
    }

    return runId;
  }

  static historyFromState(state: AgentLoopState): ChatMessage[] {
    return state.transcript;
  }

  static historyFromCheckpoint(checkpoint: AgentLoopCheckpoint): ChatMessage[] {
    return this.historyFromState(checkpoint.state);
  }

  static resolveHistory(options: {
    history?: ChatMessage[];
    resumeFrom?: AgentLoopState | AgentLoopCheckpoint;
  }): ChatMessage[] | undefined {
    if (options.history) {
      return options.history;
    }

    if (!options.resumeFrom) {
      return undefined;
    }

    if ('version' in options.resumeFrom) {
      return this.historyFromCheckpoint(options.resumeFrom);
    }

    return this.historyFromState(options.resumeFrom);
  }

  static resolveResumeMetadata(
    resumeFrom: AgentLoopState | AgentLoopCheckpoint | undefined,
  ): { checkpointRunId: string; priorTraceEvents: number } | undefined {
    if (!resumeFrom) {
      return undefined;
    }

    if ('version' in resumeFrom) {
      return {
        checkpointRunId: resumeFrom.runId,
        priorTraceEvents: resumeFrom.state.trace.length,
      };
    }

    return {
      checkpointRunId: resumeFrom.runId,
      priorTraceEvents: resumeFrom.trace.length,
    };
  }
}
