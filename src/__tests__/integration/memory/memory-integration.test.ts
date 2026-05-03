import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmAdapter, LlmResponse } from '../../../core/llm/types.js';
import { bootstrapMemoryWorkspace } from '../../../core/memory/catalog.js';
import { runMaintenanceForRecordedCandidates } from '../../../core/memory/maintenance-integration.js';
import type { TraceEvent } from '../../../core/types.js';

const fakeInfo = {
  provider: 'openai' as const,
  model: 'gpt-test',
  capabilities: {
    toolCalls: true,
    systemMessages: true,
    reasoningSummaries: false,
    parallelToolCalls: true,
  },
};

describe('memory maintenance integration', () => {
  it('maintains candidates recorded in a trace and emits lifecycle events', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-integration-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    await mkdir(join(memoryRoot, '_maintenance'), { recursive: true });
    await writeFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), `${JSON.stringify({
      id: 'candidate-integration',
      recordedAt: '2026-04-24T00:00:00.000Z',
      status: 'pending',
      summary: 'The canonical verification command is yarn build.',
      categoryHint: 'operations',
      importance: 'high',
      confidence: 'tool-verified',
      sourceRefs: ['package.json'],
    })}\n`, 'utf8');
    const emitted: TraceEvent[] = [];
    const llm = scriptedMaintainer([
      () => ({
        content: 'I will update memory.',
        toolCalls: [
          { id: 'read-root', tool: 'read_memory_note', input: { path: 'README.md' } },
          { id: 'read-ops', tool: 'read_memory_note', input: { path: 'operations/README.md' } },
          { id: 'search-existing', tool: 'search_memory_notes', input: { query: 'yarn build' } },
          {
            id: 'write-note',
            tool: 'edit_memory_note',
            input: {
              path: 'operations/verification.md',
              content: '# Verification\n\nRun `yarn build` for canonical verification.\n',
              createIfMissing: true,
            },
          },
          {
            id: 'write-catalog',
            tool: 'edit_memory_note',
            input: {
              path: 'operations/README.md',
              content: '# Operations\n\n## Notes Index\n\n- [Verification](verification.md): Canonical build verification command.\n',
            },
          },
        ],
      }),
      () => ({ content: 'Maintained verification memory.' }),
    ]);

    const result = await runMaintenanceForRecordedCandidates({
      memoryRoot,
      llm,
      source: 'test integration',
      trace: [{
        type: 'memory.candidate_recorded',
        candidateId: 'candidate-integration',
        path: '_maintenance/candidates.jsonl',
        step: 2,
        timestamp: '2026-04-24T00:00:01.000Z',
      }],
      onTraceEvent: (event) => emitted.push(event),
    });

    expect(result.candidateIds).toEqual(['candidate-integration']);
    expect(result.events.map((event) => event.type)).toEqual(['memory.maintenance_started', 'memory.maintenance_finished']);
    expect(emitted.map((event) => event.type)).toEqual(['memory.maintenance_started', 'memory.maintenance_finished']);
    expect(result.maintenance?.run.processedCandidateIds).toEqual(['candidate-integration']);
    await expect(readFile(join(memoryRoot, 'operations', 'verification.md'), 'utf8')).resolves.toContain('yarn build');
  });

  it('emits maintenance failure without throwing', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-integration-fail-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    await mkdir(join(memoryRoot, '_maintenance'), { recursive: true });
    await writeFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), `${JSON.stringify({
      id: 'candidate-fail',
      recordedAt: '2026-04-24T00:00:00.000Z',
      status: 'pending',
      summary: 'Keep this.',
      importance: 'high',
    })}\n`, 'utf8');
    const llm: LlmAdapter = {
      info: fakeInfo,
      async chat() {
        throw new Error('maintainer unavailable');
      },
    };

    const result = await runMaintenanceForRecordedCandidates({
      memoryRoot,
      llm,
      source: 'test integration',
      trace: [{
        type: 'memory.candidate_recorded',
        candidateId: 'candidate-fail',
        path: '_maintenance/candidates.jsonl',
        step: 1,
        timestamp: '2026-04-24T00:00:01.000Z',
      }],
    });

    expect(result.events.map((event) => event.type)).toEqual(['memory.maintenance_started', 'memory.maintenance_failed']);
    expect(result.events[1]).toMatchObject({
      type: 'memory.maintenance_failed',
      error: expect.stringContaining('maintainer unavailable'),
    });
  });

  it('serializes maintenance runs per memory root', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-integration-queue-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    await mkdir(join(memoryRoot, '_maintenance'), { recursive: true });
    await writeFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), [
      JSON.stringify({
        id: 'candidate-one',
        recordedAt: '2026-04-24T00:00:00.000Z',
        status: 'pending',
        summary: 'First durable fact.',
        importance: 'medium',
      }),
      JSON.stringify({
        id: 'candidate-two',
        recordedAt: '2026-04-24T00:00:01.000Z',
        status: 'pending',
        summary: 'Second durable fact.',
        importance: 'medium',
      }),
      '',
    ].join('\n'), 'utf8');
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const entered: string[] = [];
    const firstLlm: LlmAdapter = {
      info: fakeInfo,
      async chat() {
        entered.push('first');
        firstEntered.resolve();
        await releaseFirst.promise;
        return { content: 'Skipped first candidate.' };
      },
    };
    const secondLlm: LlmAdapter = {
      info: fakeInfo,
      async chat() {
        entered.push('second');
        return { content: 'Skipped second candidate.' };
      },
    };

    const firstRun = runMaintenanceForRecordedCandidates({
      memoryRoot,
      llm: firstLlm,
      source: 'first',
      trace: [candidateRecordedTrace('candidate-one')],
    });
    await firstEntered.promise;
    const secondRun = runMaintenanceForRecordedCandidates({
      memoryRoot,
      llm: secondLlm,
      source: 'second',
      trace: [candidateRecordedTrace('candidate-two')],
    });
    await Promise.resolve();

    expect(entered).toEqual(['first']);
    releaseFirst.resolve();
    await Promise.all([firstRun, secondRun]);
    expect(entered).toEqual(['first', 'second']);
  });

  it('fails gracefully when another process holds the maintenance lock', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-integration-lock-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    await mkdir(join(memoryRoot, '_maintenance'), { recursive: true });
    await writeFile(join(memoryRoot, '_maintenance', 'maintenance.lock'), `${JSON.stringify({
      id: 'other-process',
      pid: 999999,
      acquiredAt: new Date().toISOString(),
    })}\n`, 'utf8');
    await writeFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), `${JSON.stringify({
      id: 'candidate-locked',
      recordedAt: '2026-04-24T00:00:00.000Z',
      status: 'pending',
      summary: 'Locked candidate.',
      importance: 'medium',
    })}\n`, 'utf8');
    let calls = 0;
    const llm: LlmAdapter = {
      info: fakeInfo,
      async chat() {
        calls++;
        return { content: 'Should not run while locked.' };
      },
    };

    const result = await runMaintenanceForRecordedCandidates({
      memoryRoot,
      llm,
      source: 'locked',
      trace: [candidateRecordedTrace('candidate-locked')],
      lockTimeoutMs: 1,
    });

    expect(calls).toBe(0);
    expect(result.events.map((event) => event.type)).toEqual(['memory.maintenance_started', 'memory.maintenance_failed']);
    expect(result.events[1]).toMatchObject({
      type: 'memory.maintenance_failed',
      error: expect.stringContaining('Memory maintenance lock is busy'),
    });
    await expect(stat(join(memoryRoot, '_maintenance', 'maintenance.lock'))).resolves.toBeTruthy();
  });

  it('recovers stale maintenance locks', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-integration-stale-lock-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    await mkdir(join(memoryRoot, '_maintenance'), { recursive: true });
    await writeFile(join(memoryRoot, '_maintenance', 'maintenance.lock'), `${JSON.stringify({
      id: 'stale-process',
      pid: 999999,
      acquiredAt: '2020-01-01T00:00:00.000Z',
    })}\n`, 'utf8');
    await writeFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), `${JSON.stringify({
      id: 'candidate-stale-lock',
      recordedAt: '2026-04-24T00:00:00.000Z',
      status: 'pending',
      summary: 'Stale lock candidate.',
      importance: 'medium',
    })}\n`, 'utf8');
    const llm = scriptedMaintainer([
      () => ({ content: 'Processed after stale lock recovery.' }),
    ]);

    const result = await runMaintenanceForRecordedCandidates({
      memoryRoot,
      llm,
      source: 'stale lock',
      trace: [candidateRecordedTrace('candidate-stale-lock')],
      lockStaleAfterMs: 1,
    });

    expect(result.events.map((event) => event.type)).toEqual(['memory.maintenance_started', 'memory.maintenance_finished']);
    await expect(stat(join(memoryRoot, '_maintenance', 'maintenance.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('records candidate trace events when record_knowledge succeeds', async () => {
    const { runAgent } = await import('../../../core/agent/run-agent.js');
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-candidate-trace-'));
    const trace: TraceEvent[] = [];
    const llm = scriptedMaintainer([
      () => ({
        content: 'I will record this memory.',
        toolCalls: [{
          id: 'record-1',
          tool: 'record_knowledge',
          input: {
            summary: 'The canonical verification command is yarn build.',
            importance: 'high',
            confidence: 'tool-verified',
          },
        }],
      }),
      () => ({ content: 'Recorded.' }),
    ]);
    const { createRecordKnowledgeTool } = await import('../../../core/tools/toolkits/knowledge/record-knowledge.js');

    const result = await runAgent({
      goal: 'Record memory.',
      llm,
      tools: [createRecordKnowledgeTool({
        memoryRoot,
        now: () => new Date('2026-04-24T00:00:00.000Z'),
        nextId: () => 'candidate-trace',
      })],
      maxSteps: 3,
      onEvent: (event) => trace.push(event),
    });

    expect(result.outcome).toBe('done');
    expect(trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'memory.candidate_recorded',
        candidateId: 'candidate-trace',
      }),
    ]));
  });

  it('records a memory checkpoint when the agent chooses to preserve explicit user memory intent', async () => {
    const { runAgent } = await import('../../../core/agent/run-agent.js');
    const { buildMemoryDomainSystemContext } = await import('../../../core/memory/domain-prompt.js');
    const { createMemoryCheckpointTool } = await import('../../../core/tools/toolkits/knowledge/memory-checkpoint.js');
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-checkpoint-required-'));
    const seenMessages: unknown[] = [];
    const llm = scriptedMaintainer([
      () => ({
        content: 'Recording the durable preference.',
        toolCalls: [{
          id: 'checkpoint-1',
          tool: 'memory_checkpoint',
          input: {
            decision: 'record',
            rationale: 'The user explicitly asked to remember a durable ticket format preference.',
            candidate: {
              summary: 'Use the compact ticket format for future ticket creation.',
              categoryHint: 'workflows',
              importance: 'high',
              confidence: 'user-stated',
              sourceRefs: ['conversation'],
            },
          },
        }],
      }),
      () => ({ content: 'I recorded that ticket format preference for future use.' }),
    ]);
    const originalChat = llm.chat.bind(llm);
    llm.chat = async (messages, tools, signal, onStream) => {
      seenMessages.push(messages);
      return await originalChat(messages, tools, signal, onStream);
    };

    const result = await runAgent({
      goal: 'Remember that my preferred ticket format is compact, but do not create a ticket now.',
      llm,
      tools: [createMemoryCheckpointTool({
        memoryRoot,
        now: () => new Date('2026-04-24T00:00:00.000Z'),
        nextId: () => 'candidate-memory-checkpoint',
      })],
      systemContext: buildMemoryDomainSystemContext(),
      maxSteps: 4,
    });

    expect(result.outcome).toBe('done');
    expect(JSON.stringify(seenMessages)).toContain('Before the final answer, run a quick memory checkpoint');
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'memory.candidate_recorded',
        candidateId: 'candidate-memory-checkpoint',
      }),
    ]));
    await expect(readFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), 'utf8')).resolves.toContain('compact ticket format');
  });

  it('allows memory checkpoint to explicitly skip one-off turns', async () => {
    const { runAgent } = await import('../../../core/agent/run-agent.js');
    const { createMemoryCheckpointTool } = await import('../../../core/tools/toolkits/knowledge/memory-checkpoint.js');
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-checkpoint-skip-'));
    const llm: LlmAdapter = {
      info: fakeInfo,
      async chat(messages): Promise<LlmResponse> {
        const hostReminder = [...messages].reverse().find(
          (message) => message.role === 'system' && message.content.includes('Before your final answer, call memory_checkpoint'),
        );
        const completedCheckpoint = messages.some(
          (message) => message.role === 'tool' && message.content.includes('Memory checkpoint skipped recording'),
        );
        if (completedCheckpoint) {
          return { content: 'The one-off check is complete.' };
        }
        if (!messages.some((message) => message.role === 'tool')) {
          return {
            content: 'Checking the workspace.',
            toolCalls: [{ id: 'noop-1', tool: 'noop_tool', input: {} }],
          };
        }
        if (hostReminder) {
          return {
            content: 'Skipping memory.',
            toolCalls: [{
              id: 'checkpoint-skip',
              tool: 'memory_checkpoint',
              input: {
                decision: 'skip',
                rationale: 'The turn only completed a one-off check and did not discover durable reusable knowledge.',
              },
            }],
          };
        }
        return { content: 'The one-off check is complete.' };
      },
    };

    const result = await runAgent({
      goal: 'Do a one-off check.',
      llm,
      tools: [
        {
          name: 'noop_tool',
          description: 'No-op test tool.',
          parameters: { type: 'object', additionalProperties: false, properties: {} },
          async execute() {
            return { ok: true, output: 'checked' };
          },
        },
        createMemoryCheckpointTool({ memoryRoot }),
      ],
      maxSteps: 5,
    });

    expect(result.outcome).toBe('done');
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'memory.checkpoint_skipped',
        rationale: expect.stringContaining('one-off check'),
      }),
    ]));
    await expect(readFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function candidateRecordedTrace(candidateId: string): TraceEvent {
  return {
    type: 'memory.candidate_recorded',
    candidateId,
    path: '_maintenance/candidates.jsonl',
    step: 1,
    timestamp: '2026-04-24T00:00:01.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function scriptedMaintainer(responses: Array<() => LlmResponse>): LlmAdapter {
  let index = 0;
  return {
    info: fakeInfo,
    async chat(): Promise<LlmResponse> {
      const response = responses[Math.min(index, responses.length - 1)]();
      index++;
      return response;
    },
  };
}
