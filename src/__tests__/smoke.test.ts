// ---------------------------------------------------------------------------
// Smoke Test — validates core wiring without LLM calls
// ---------------------------------------------------------------------------

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { runAgent } from '../run-agent.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { formatTraceForConsole } from '../trace/format.js';
import { createToolRegistry } from '../tools/registry.js';
import { listFilesTool } from '../tools/list-files.js';
import { readFileTool } from '../tools/read-file.js';
import { createBudget } from '../utils/budget.js';
import { createTraceRecorder } from '../trace/recorder.js';
import { searchFilesTool } from '../tools/search-files.js';
import type { ChatMessage, LlmAdapter, LlmResponse } from '../llm/types.js';
import type { ToolDefinition, TraceEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

describe('createToolRegistry', () => {
  const fakeTool: ToolDefinition = {
    name: 'test_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, output: 'hello' }),
  };

  it('registers and retrieves a tool by name', () => {
    const registry = createToolRegistry([fakeTool]);
    expect(registry.get('test_tool')).toBe(fakeTool);
  });

  it('returns undefined for unknown tools', () => {
    const registry = createToolRegistry([fakeTool]);
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all tool names', () => {
    const another: ToolDefinition = { ...fakeTool, name: 'another' };
    const registry = createToolRegistry([fakeTool, another]);
    expect(registry.names()).toEqual(['test_tool', 'another']);
  });

  it('throws on duplicate tool names', () => {
    expect(() => createToolRegistry([fakeTool, fakeTool])).toThrow('Duplicate tool name');
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe('createBudget', () => {
  it('counts steps and reports exhaustion', () => {
    const budget = createBudget(3);

    expect(budget.remaining()).toBe(3);
    expect(budget.exhausted()).toBe(false);

    budget.step();
    expect(budget.remaining()).toBe(2);

    budget.step();
    budget.step();
    expect(budget.remaining()).toBe(0);
    expect(budget.exhausted()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trace Recorder
// ---------------------------------------------------------------------------

describe('createTraceRecorder', () => {
  it('records events and exports them', () => {
    const recorder = createTraceRecorder();

    const event1: TraceEvent = { type: 'run.started', goal: 'test', timestamp: '2024-01-01T00:00:00Z' };
    const event2: TraceEvent = {
      type: 'run.finished',
      outcome: 'done',
      summary: 'all good',
      step: 1,
      timestamp: '2024-01-01T00:00:01Z',
    };

    recorder.record(event1);
    recorder.record(event2);

    const trace = recorder.getTrace();
    expect(trace).toHaveLength(2);
    expect(trace[0]).toEqual(event1);
    expect(trace[1]).toEqual(event2);
  });

  it('exports valid JSON', () => {
    const recorder = createTraceRecorder();
    recorder.record({ type: 'run.started', goal: 'test', timestamp: '2024-01-01T00:00:00Z' });

    const json = recorder.toJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('run.started');
  });

  it('returns a copy from getTrace so mutations do not affect the recorder', () => {
    const recorder = createTraceRecorder();
    recorder.record({ type: 'run.started', goal: 'test', timestamp: '2024-01-01T00:00:00Z' });

    const trace = recorder.getTrace();
    trace.pop();
    expect(recorder.getTrace()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Agent Loop
// ---------------------------------------------------------------------------

describe('runAgent', () => {
  it('executes tool calls, appends tool output, and finishes with a final answer', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(messages);

        if (seenMessages.length === 1) {
          return {
            content: 'I will inspect the repo first.',
            toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
          };
        }

        return {
          content: 'The repo contains README.md and src/.',
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await runAgent({
      goal: 'What is in this repo?',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 3,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The repo contains README.md and src/.');
    expect(seenMessages).toHaveLength(2);
    expect(seenMessages[1]).toContainEqual({
      role: 'tool',
      content: JSON.stringify('README.md\nsrc/'),
      toolCallId: 'call-1',
    });
    expect(result.trace.map((event) => event.type)).toEqual([
      'run.started',
      'assistant.turn',
      'tool.call',
      'tool.result',
      'assistant.turn',
      'run.finished',
    ]);
    expect(result.trace[1]).toMatchObject({
      type: 'assistant.turn',
      content: 'I will inspect the repo first.',
      requestedTools: true,
      toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
    });
    expect(result.trace[4]).toMatchObject({
      type: 'assistant.turn',
      content: 'The repo contains README.md and src/.',
      requestedTools: false,
    });
  });
});

describe('tool input validation', () => {
  it('rejects unexpected fields for list_files', async () => {
    const result = await listFilesTool.execute({ path: '.', maxLines: 20 });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for list_files. Allowed fields: path.',
    });
  });

  it('rejects unexpected fields for read_file', async () => {
    const result = await readFileTool.execute({ path: 'README.md', query: 'tool' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for read_file. Required field: path. Optional field: maxLines.',
    });
  });

  it('tool descriptions distinguish directories from files', () => {
    expect(listFilesTool.description).toContain('Use this to inspect folders, not to read file contents');
    expect(readFileTool.description).toContain('not when you want to inspect a directory');
  });
});

describe('tool path mismatch guidance', () => {
  it('tells the caller to use read_file when list_files receives a file path', async () => {
    const result = await listFilesTool.execute({ path: 'README.md' });

    expect(result).toEqual({
      ok: false,
      error: `Failed to list ${join(process.cwd(), 'README.md')}: path is a file, not a directory. Use read_file for file contents.`,
    });
  });

  it('tells the caller to use list_files when read_file receives a directory path', async () => {
    const result = await readFileTool.execute({ path: 'src' });

    expect(result).toEqual({
      ok: false,
      error: `Failed to read ${join(process.cwd(), 'src')}: path is a directory, not a file. Use list_files to inspect directories.`,
    });
  });
});

describe('buildSystemPrompt', () => {
  it('encourages brief rationale before tool use', () => {
    const prompt = buildSystemPrompt('Inspect the repo', ['list_files', 'read_file']);

    expect(prompt).toContain('Before calling tools, briefly state what you are about to check');
    expect(prompt).toContain('Use tools purposefully');
  });
});

describe('searchFilesTool', () => {
  it('ignores generated directories like dist and node_modules by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-search-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'dist'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'src', 'main.ts'), 'const needle = true;\n');
    await writeFile(join(root, 'dist', 'generated.ts'), 'const needle = true;\n');
    await writeFile(join(root, 'node_modules', 'pkg.ts'), 'const needle = true;\n');

    const result = await searchFilesTool.execute({ query: 'needle', path: root });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('src/main.ts');
    expect(result.output).not.toContain('dist/generated.ts');
    expect(result.output).not.toContain('node_modules/pkg.ts');
  });
});

describe('formatTraceForConsole', () => {
  it('renders assistant turns with text and requested tools', () => {
    const output = formatTraceForConsole([
      {
        type: 'assistant.turn',
        content: 'I will inspect the repo first.',
        requestedTools: true,
        toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
        step: 1,
        timestamp: '2024-01-01T00:00:00Z',
      },
    ]);

    expect(output).toContain('Assistant:');
    expect(output).toContain('I will inspect the repo first.');
    expect(output).toContain('Requested Tools: list_files (1)');
  });

  it('renders assistant turns with no text and requested tools compactly', () => {
    const output = formatTraceForConsole([
      {
        type: 'assistant.turn',
        content: '',
        requestedTools: true,
        toolCalls: [
          { id: 'call-1', tool: 'list_files', input: { path: '.' } },
          { id: 'call-2', tool: 'read_file', input: { path: 'README.md' } },
        ],
        step: 2,
        timestamp: '2024-01-01T00:00:01Z',
      },
    ]);

    expect(output).toContain('(no text content; requested 2 tool calls)');
    expect(output).toContain('Requested Tools: list_files, read_file (2)');
  });

  it('renders assistant turns with final text only', () => {
    const output = formatTraceForConsole([
      {
        type: 'assistant.turn',
        content: 'The repo contains README.md and src/.',
        requestedTools: false,
        step: 3,
        timestamp: '2024-01-01T00:00:02Z',
      },
    ]);

    expect(output).toContain('Assistant:');
    expect(output).toContain('The repo contains README.md and src/.');
    expect(output).not.toContain('Requested Tools:');
  });
});
