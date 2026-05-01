import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, LlmAdapter, LlmResponse } from '../../../core/llm/types.js';
import type { ToolDefinition } from '../../../core/types.js';
import { bootstrapMemoryWorkspace } from '../../../core/memory/catalog.js';
import { createMemoryMaintainerTools } from '../../../core/memory/maintainer-tools.js';
import {
  readPendingKnowledgeCandidates,
  runKnowledgeMaintenance,
  type KnowledgeCandidate,
} from '../../../core/memory/maintainer.js';

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

describe('memory maintainer', () => {
  it('creates a new cataloged note from a candidate and records the run', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-maintainer-create-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    const seenTools: string[][] = [];
    const llm = scriptedMaintainer([
      (_messages, tools) => {
        seenTools.push(tools.map((tool) => tool.name));
        return {
          content: 'I will inspect the catalogs and then update memory.',
          toolCalls: [
            { id: 'read-root', tool: 'read_memory_note', input: { path: 'README.md' } },
            { id: 'read-ops', tool: 'read_memory_note', input: { path: 'operations/README.md' } },
            { id: 'search-existing', tool: 'search_memory_notes', input: { query: 'canonical verification command' } },
            {
              id: 'write-note',
              tool: 'edit_memory_note',
              input: {
                path: 'operations/verification.md',
                content: '# Verification\n\nThe canonical verification command is `yarn build`.\n',
                createIfMissing: true,
              },
            },
            {
              id: 'write-catalog',
              tool: 'edit_memory_note',
              input: {
                path: 'operations/README.md',
                content: '# Operations\n\n## Notes Index\n\n- [Verification](verification.md): canonical verification command.\n',
              },
            },
          ],
        };
      },
      () => ({ content: 'Created operations/verification.md and updated operations/README.md.' }),
    ]);

    const result = await runKnowledgeMaintenance({
      memoryRoot,
      observations: [candidate('candidate-1', 'The canonical verification command is yarn build.')],
      llm,
      source: 'test',
      now: fixedNow,
      nextRunId: () => 'run-create',
    });

    await expect(readFile(join(memoryRoot, 'operations', 'verification.md'), 'utf8')).resolves.toContain('yarn build');
    await expect(readFile(join(memoryRoot, 'operations', 'README.md'), 'utf8')).resolves.toContain('verification.md');
    expect(seenTools[0]).toEqual(['list_memory_notes', 'read_memory_note', 'search_memory_notes', 'edit_memory_note']);
    expect(result.run).toMatchObject({
      id: 'run-create',
      outcome: 'done',
      candidateIds: ['candidate-1'],
      processedCandidateIds: ['candidate-1'],
      failedCandidateIds: [],
      catalogValid: true,
    });
    const runs = await readFile(join(memoryRoot, '_maintenance', 'runs.jsonl'), 'utf8');
    expect(runs).toContain('"id":"run-create"');
    const candidates = await readFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), 'utf8');
    expect(candidates).toContain('"kind":"candidate_status"');
    expect(candidates).toContain('"candidateId":"candidate-1"');
  });

  it('updates an existing note instead of creating a duplicate', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-maintainer-update-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    await writeFile(join(memoryRoot, 'operations', 'verification.md'), '# Verification\n\nRun tests with `yarn test`.\n', 'utf8');
    const llm = scriptedMaintainer([
      () => ({
        content: 'I found an existing note and will update it.',
        toolCalls: [
          { id: 'read-ops', tool: 'read_memory_note', input: { path: 'operations/README.md' } },
          { id: 'search-existing', tool: 'search_memory_notes', input: { query: 'Verification' } },
          {
            id: 'update-note',
            tool: 'edit_memory_note',
            input: {
              path: 'operations/verification.md',
              oldText: 'Run tests with `yarn test`.',
              newText: 'Run tests with `yarn test`; run the canonical build check with `yarn build`.',
            },
          },
        ],
      }),
      () => ({ content: 'Updated operations/verification.md.' }),
    ]);

    await runKnowledgeMaintenance({
      memoryRoot,
      observations: [candidate('candidate-2', 'The canonical build check is yarn build.')],
      llm,
      source: 'test',
    });

    const note = await readFile(join(memoryRoot, 'operations', 'verification.md'), 'utf8');
    expect(note).toContain('yarn build');
  });

  it('lets the maintainer judge low-importance candidates but prefilters secret-like candidates', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-maintainer-skip-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    let calls = 0;
    const llm = scriptedMaintainer([
      () => {
        calls++;
        return { content: 'Skipped the low-importance scratch note.' };
      },
    ]);

    const result = await runKnowledgeMaintenance({
      memoryRoot,
      observations: [
        { ...candidate('candidate-low', 'Temporary scratch note.'), importance: 'low' },
        candidate('candidate-secret', 'The API key is sk-test-secret-value-123456'),
      ],
      llm,
      source: 'test',
    });

    expect(calls).toBe(1);
    expect(result.run.outcome).toBe('done');
    expect(result.run.processedCandidateIds).toEqual(['candidate-low']);
    expect(result.run.failedCandidateIds).toEqual(['candidate-secret']);
  });

  it('keeps pending candidate state append-only and skips processed candidates', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-maintainer-pending-'));
    await mkdir(join(memoryRoot, '_maintenance'), { recursive: true });
    await writeFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), [
      JSON.stringify(candidate('candidate-pending', 'Keep this pending.')),
      JSON.stringify(candidate('candidate-processed', 'Already done.')),
      JSON.stringify({ kind: 'candidate_status', candidateId: 'candidate-processed', status: 'processed', runId: 'run-1', recordedAt: '2026-04-24T00:00:00.000Z' }),
      '',
    ].join('\n'), 'utf8');

    const pending = await readPendingKnowledgeCandidates({ memoryRoot });

    expect(pending.map((item) => item.id)).toEqual(['candidate-pending']);
  });

  it('maintainer edit tools cannot write outside the memory root', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-maintainer-scope-'));
    const editTool = createMemoryMaintainerTools({ memoryRoot }).find((tool) => tool.name === 'edit_memory_note');

    const result = await editTool?.execute({
      path: '../outside.md',
      content: 'bad',
      createIfMissing: true,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('must stay inside'),
    });
  });
});

function candidate(id: string, summary: string): KnowledgeCandidate {
  return {
    id,
    recordedAt: '2026-04-24T00:00:00.000Z',
    status: 'pending',
    summary,
    categoryHint: 'operations',
    importance: 'high',
    confidence: 'tool-verified',
    sourceRefs: ['package.json'],
  };
}

function fixedNow(): Date {
  return new Date('2026-04-24T00:00:00.000Z');
}

function scriptedMaintainer(responses: Array<(messages: ChatMessage[], tools: ToolDefinition[]) => LlmResponse>): LlmAdapter {
  let index = 0;
  return {
    info: fakeInfo,
    async chat(messages, tools): Promise<LlmResponse> {
      const response = responses[Math.min(index, responses.length - 1)](messages, tools);
      index++;
      return response;
    },
  };
}
