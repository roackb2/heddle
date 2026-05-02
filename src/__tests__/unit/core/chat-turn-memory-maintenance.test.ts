import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChatSession, loadChatSessions, saveChatSessions } from '../../../core/chat/storage.js';
import { appendAgentLoopTrace, appendTurnMemoryMaintenanceEvents } from '../../../core/chat/turn-memory-maintenance.js';
import type { AgentLoopResult } from '../../../core/runtime/agent-loop.js';
import type { TraceEvent } from '../../../core/types.js';

describe('chat turn memory maintenance helpers', () => {
  it('appends background maintenance events to the trace file and latest turn summary', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-maintenance-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const traceFile = join(root, 'trace.json');
    const baseTrace: TraceEvent[] = [{
      type: 'memory.candidate_recorded',
      candidateId: 'candidate-1',
      path: '_maintenance/candidates.jsonl',
      step: 1,
      timestamp: '2026-05-02T00:00:00.000Z',
    }];
    writeFileSync(traceFile, `${JSON.stringify(baseTrace, null, 2)}\n`, 'utf8');

    const session = createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    saveChatSessions(sessionStoragePath, [{
      ...session,
      turns: [{
        id: 'turn-1',
        prompt: 'Remember this',
        outcome: 'done',
        summary: 'Done.',
        steps: 1,
        traceFile,
        events: ['memory candidate recorded: candidate-1'],
      }],
    }]);

    appendTurnMemoryMaintenanceEvents({
      traceFile,
      events: [{
        type: 'memory.maintenance_finished',
        runId: 'memory-run-1',
        outcome: 'done',
        summary: 'Stored memory.',
        processedCandidateIds: ['candidate-1'],
        failedCandidateIds: [],
        step: 2,
        timestamp: '2026-05-02T00:00:01.000Z',
      }],
      sessionStoragePath,
      sessionId: 'session-1',
    });

    const nextTrace = JSON.parse(readFileSync(traceFile, 'utf8')) as TraceEvent[];
    expect(nextTrace.map((event) => event.type)).toEqual([
      'memory.candidate_recorded',
      'memory.maintenance_finished',
    ]);
    expect(loadChatSessions(sessionStoragePath, true)[0]?.turns[0]?.events).toEqual([
      'memory candidate recorded: candidate-1',
      'memory maintenance finished: done',
    ]);
  });

  it('appends inline maintenance events to both result trace locations', () => {
    const baseTrace: TraceEvent[] = [{
      type: 'run.started',
      goal: 'test',
      timestamp: '2026-05-02T00:00:00.000Z',
    }];
    const result: AgentLoopResult = {
      outcome: 'done',
      summary: 'Done.',
      trace: baseTrace,
      transcript: [],
      model: 'gpt-5.4',
      provider: 'openai',
      workspaceRoot: '/repo',
      state: {
        status: 'finished',
        runId: 'run-1',
        goal: 'test',
        model: 'gpt-5.4',
        provider: 'openai',
        workspaceRoot: '/repo',
        startedAt: '2026-05-02T00:00:00.000Z',
        finishedAt: '2026-05-02T00:00:01.000Z',
        outcome: 'done',
        summary: 'Done.',
        transcript: [],
        trace: baseTrace,
      },
    };

    const next = appendAgentLoopTrace(result, [{
      type: 'memory.maintenance_failed',
      runId: 'memory-run-1',
      error: 'failed',
      candidateIds: [],
      step: 2,
      timestamp: '2026-05-02T00:00:02.000Z',
    }]);

    expect(next.trace.map((event) => event.type)).toEqual(['run.started', 'memory.maintenance_failed']);
    expect(next.state.trace).toEqual(next.trace);
    expect(result.trace).toEqual(baseTrace);
  });
});
