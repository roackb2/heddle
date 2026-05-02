import { readFileSync, writeFileSync } from 'node:fs';
import type { LlmAdapter } from '../llm/types.js';
import type { AgentLoopResult } from '../runtime/agent-loop.js';
import type { AgentLoopEvent } from '../runtime/events.js';
import type { TraceEvent } from '../types.js';
import { runMaintenanceForRecordedCandidates } from '../memory/maintenance-integration.js';
import { loadChatSessions, saveChatSessions, touchSession } from './storage.js';
import { summarizeTrace } from './trace-summary.js';

export type RunInlineTurnMemoryMaintenanceArgs = {
  memoryRoot: string;
  llm: LlmAdapter;
  source: string;
  result: AgentLoopResult;
  onEvent?: (event: AgentLoopEvent) => void;
};

export async function runInlineTurnMemoryMaintenance(
  args: RunInlineTurnMemoryMaintenanceArgs,
): Promise<AgentLoopResult> {
  const maintenance = await runMaintenanceForRecordedCandidates({
    memoryRoot: args.memoryRoot,
    llm: args.llm,
    source: args.source,
    trace: args.result.trace,
    maxSteps: 20,
    onTraceEvent: (event) => args.onEvent?.({
      type: 'trace',
      runId: args.result.state.runId,
      event,
      timestamp: new Date().toISOString(),
    }),
  });

  return appendAgentLoopTrace(args.result, maintenance.events);
}

export type ScheduleBackgroundTurnMemoryMaintenanceArgs = {
  memoryRoot: string;
  llm: LlmAdapter;
  source: string;
  trace: AgentLoopResult['trace'];
  traceFile: string;
  sessionStoragePath: string;
  sessionId: string;
  runId: string;
  onEvent?: (event: AgentLoopEvent) => void;
};

export function scheduleBackgroundTurnMemoryMaintenance(args: ScheduleBackgroundTurnMemoryMaintenanceArgs) {
  void runBackgroundTurnMemoryMaintenance(args).catch((error) => {
    args.onEvent?.({
      type: 'trace',
      runId: args.runId,
      event: createMemoryMaintenanceFailureEvent({
        error,
        trace: args.trace,
      }),
      timestamp: new Date().toISOString(),
    });
  });
}

export async function runBackgroundTurnMemoryMaintenance(args: ScheduleBackgroundTurnMemoryMaintenanceArgs) {
  const maintenance = await runMaintenanceForRecordedCandidates({
    memoryRoot: args.memoryRoot,
    llm: args.llm,
    source: args.source,
    trace: args.trace,
    maxSteps: 20,
    onTraceEvent: (event) => args.onEvent?.({
      type: 'trace',
      runId: args.runId,
      event,
      timestamp: new Date().toISOString(),
    }),
  });
  if (maintenance.events.length === 0) {
    return;
  }

  appendTurnMemoryMaintenanceEvents({
    traceFile: args.traceFile,
    events: maintenance.events,
    sessionStoragePath: args.sessionStoragePath,
    sessionId: args.sessionId,
  });
}

export function appendTurnMemoryMaintenanceEvents(args: {
  traceFile: string;
  events: TraceEvent[];
  sessionStoragePath: string;
  sessionId: string;
}) {
  const nextTrace = [...readTraceEvents(args.traceFile), ...args.events];
  writeFileSync(args.traceFile, `${JSON.stringify(nextTrace, null, 2)}\n`, 'utf8');

  const sessions = loadChatSessions(args.sessionStoragePath, true);
  const nextSessions = sessions.map((session) => {
    if (session.id !== args.sessionId) {
      return session;
    }

    return touchSession({
      ...session,
      turns: session.turns.map((turn, index) => (
        index === session.turns.length - 1 ?
          {
            ...turn,
            events: summarizeTrace(nextTrace),
          }
        : turn
      )),
    });
  });
  saveChatSessions(args.sessionStoragePath, nextSessions);
}

export function appendAgentLoopTrace(result: AgentLoopResult, events: TraceEvent[]): AgentLoopResult {
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

function readTraceEvents(path: string): AgentLoopResult['trace'] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed as AgentLoopResult['trace'] : [];
  } catch {
    return [];
  }
}

function createMemoryMaintenanceFailureEvent(args: {
  error: unknown;
  trace: TraceEvent[];
}): Extract<TraceEvent, { type: 'memory.maintenance_failed' }> {
  return {
    type: 'memory.maintenance_failed',
    runId: `memory-run-${Date.now()}`,
    error: args.error instanceof Error ? args.error.message : String(args.error),
    candidateIds: [],
    step: nextTraceStep(args.trace),
    timestamp: new Date().toISOString(),
  };
}

function nextTraceStep(trace: TraceEvent[]): number {
  return trace.reduce((max, event) => 'step' in event ? Math.max(max, event.step) : max, 0) + 1;
}
