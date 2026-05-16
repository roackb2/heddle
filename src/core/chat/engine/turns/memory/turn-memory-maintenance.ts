import { readFileSync, writeFileSync } from 'node:fs';
import type { AgentLoopResult } from '@/core/runtime/agent-loop.js';
import type { TraceEvent } from '@/core/types.js';
import { runMaintenanceForRecordedCandidates } from '@/core/memory/maintenance-integration.js';
import { summarizeTrace } from '@/core/observability/trace-summarizers.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type {
  AppendTurnMemoryMaintenanceEventsArgs,
  RunMemoryMaintenanceCoreArgs,
  RunInlineTurnMemoryMaintenanceArgs,
  ScheduleBackgroundTurnMemoryMaintenanceArgs,
} from './types.js';

/**
 * Runs and records memory maintenance associated with a completed turn.
 */
export class ConversationTurnMemoryMaintenance {
  static async runInline(args: RunInlineTurnMemoryMaintenanceArgs): Promise<AgentLoopResult> {
    const maintenanceInput: RunMemoryMaintenanceCoreArgs = {
      memoryRoot: args.memoryRoot,
      llm: args.llm,
      source: args.source,
      trace: args.result.trace,
    };
    const maintenance = await runMaintenanceForRecordedCandidates({
      ...maintenanceInput,
      maxSteps: 20,
      onTraceEvent: (event) =>
        args.onEvent?.({
          type: 'trace',
          runId: args.result.state.runId,
          event,
          timestamp: new Date().toISOString(),
        }),
    });

    return ConversationTurnMemoryMaintenance.appendAgentLoopTrace(args.result, maintenance.events);
  }

  static scheduleBackground(args: ScheduleBackgroundTurnMemoryMaintenanceArgs) {
    void ConversationTurnMemoryMaintenance.runBackground(args).catch((error) => {
      args.onEvent?.({
        type: 'trace',
        runId: args.runId,
        event: ConversationTurnMemoryMaintenance.createFailureEvent({
          error,
          trace: args.trace,
        }),
        timestamp: new Date().toISOString(),
      });
    });
  }

  static async runBackground(args: ScheduleBackgroundTurnMemoryMaintenanceArgs) {
    const maintenanceInput: RunMemoryMaintenanceCoreArgs = args;
    const maintenance = await runMaintenanceForRecordedCandidates({
      ...maintenanceInput,
      maxSteps: 20,
      onTraceEvent: (event) =>
        args.onEvent?.({
          type: 'trace',
          runId: args.runId,
          event,
          timestamp: new Date().toISOString(),
        }),
    });
    if (maintenance.events.length === 0) {
      return;
    }

    ConversationTurnMemoryMaintenance.appendEvents({
      ...args,
      events: maintenance.events,
    });
  }

  static appendEvents(args: AppendTurnMemoryMaintenanceEventsArgs) {
    const nextTrace = [...ConversationTurnMemoryMaintenance.readTraceEvents(args.traceFile), ...args.events];
    writeFileSync(args.traceFile, `${JSON.stringify(nextTrace, null, 2)}\n`, 'utf8');

    const repository = new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath });
    const sessions = repository.list(true);
    const nextSessions = sessions.map((session) => {
      if (session.id !== args.sessionId) {
        return session;
      }

      return ChatSessionRecords.touch({
        ...session,
        turns: session.turns.map((turn, index) =>
          index === session.turns.length - 1
            ? {
                ...turn,
                events: summarizeTrace(nextTrace),
              }
            : turn,
        ),
      });
    });
    repository.save(nextSessions);
  }

  static appendAgentLoopTrace(result: AgentLoopResult, events: TraceEvent[]): AgentLoopResult {
    if (events.length === 0) {
      return {
        ...result,
        state: {
          ...result.state,
          trace: result.trace,
        },
      };
    }

    const trace = [...result.trace, ...events];
    return {
      ...result,
      trace,
      state: {
        ...result.state,
        trace,
      },
    };
  }

  private static readTraceEvents(path: string): AgentLoopResult['trace'] {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      return Array.isArray(parsed) ? (parsed as AgentLoopResult['trace']) : [];
    } catch {
      return [];
    }
  }

  private static createFailureEvent(args: {
    error: unknown;
    trace: TraceEvent[];
  }): Extract<TraceEvent, { type: 'memory.maintenance_failed' }> {
    return {
      type: 'memory.maintenance_failed',
      runId: `memory-run-${Date.now()}`,
      error: args.error instanceof Error ? args.error.message : String(args.error),
      candidateIds: [],
      step: ConversationTurnMemoryMaintenance.nextTraceStep(args.trace),
      timestamp: new Date().toISOString(),
    };
  }

  private static nextTraceStep(trace: TraceEvent[]): number {
    return trace.reduce((max, event) => ('step' in event ? Math.max(max, event.step) : max), 0) + 1;
  }
}
