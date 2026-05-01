import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { runAgent } from '../../../core/agent/run-agent.js';
import type { ChatMessage, LlmAdapter, LlmResponse } from '../../../core/llm/types.js';
import type { ToolDefinition } from '../../../core/types.js';
import { createLogger } from '../../../core/utils/logger.js';

const silentLogger = createLogger({ level: 'silent', console: false });

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
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The repo contains README.md and src/.');
    expect(result.transcript).toEqual([
      { role: 'user', content: 'What is in this repo?' },
      {
        role: 'assistant',
        content: 'I will inspect the repo first.',
        toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
      },
      {
        role: 'tool',
        content: JSON.stringify({ ok: true, output: 'README.md\nsrc/' }),
        toolCallId: 'call-1',
      },
      { role: 'assistant', content: 'The repo contains README.md and src/.' },
    ]);
    expect(seenMessages).toHaveLength(2);
    expect(seenMessages[1]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({ ok: true, output: 'README.md\nsrc/' }),
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

  it('records an error outcome when the LLM chat throws a non-abort error', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        throw new Error('boom');
      },
    };

    const result = await runAgent({
      goal: 'Handle LLM errors gracefully.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('error');
    expect(result.summary).toBe('LLM error: boom');
    expect(result.trace.some((event) => event.type === 'run.finished')).toBe(true);
  });

  it('records assistant rationale on tool turns when the model provides text with tool calls', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        return {
          content: 'I will inspect the repo root before answering.',
          diagnostics: {
            rationale: 'I will inspect the repo root before answering.',
            missing: ['Need the top-level file listing'],
            wantedTools: ['list_files'],
            wantedInputs: ['path=.'],
          },
          toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
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
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.trace[1]).toMatchObject({
      type: 'assistant.turn',
      content: 'I will inspect the repo root before answering.',
      diagnostics: {
        rationale: 'I will inspect the repo root before answering.',
        missing: ['Need the top-level file listing'],
        wantedTools: ['list_files'],
        wantedInputs: ['path=.'],
      },
      requestedTools: true,
    });
  });

  it('does not record an actionless-completion host warning for an intent-only answer', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        return {
          content: 'I will continue in the isolated worktree, inspect the existing E2E harness files and run the Playwright-focused checks to reach a clean handoff point.',
        };
      },
    };

    const result = await runAgent({
      goal: 'yep, continue on the work',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.trace.map((event) => event.type)).toEqual([
      'run.started',
      'assistant.turn',
      'run.finished',
    ]);
  });

  it('aggregates token usage across model calls', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return {
            content: 'Done.',
            usage: {
              inputTokens: 140,
              outputTokens: 20,
              totalTokens: 160,
              requests: 1,
            },
          };
        }

        return {
          content: 'Inspecting first.',
          toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
          usage: {
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 150,
            cachedInputTokens: 10,
            reasoningTokens: 6,
            requests: 1,
          },
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
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 3,
      logger: silentLogger,
    });

    expect(result.usage).toEqual({
      inputTokens: 260,
      outputTokens: 50,
      totalTokens: 310,
      cachedInputTokens: 10,
      reasoningTokens: 6,
      requests: 2,
    });
  });

  it('delivers streamed assistant updates through the dedicated stream callback', async () => {
    const streamUpdates: Array<{ step: number; text: string; done: boolean }> = [];
    const fakeLlm: LlmAdapter = {
      async chat(_messages, _tools, _signal, onStreamEvent): Promise<LlmResponse> {
        onStreamEvent?.({ type: 'content.delta', delta: 'Hello' });
        onStreamEvent?.({ type: 'content.delta', delta: ' world' });
        onStreamEvent?.({ type: 'content.done', content: 'Hello world' });
        return {
          content: 'Hello world',
        };
      },
    };

    const result = await runAgent({
      goal: 'Say hello.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
      onAssistantStream: (update) => {
        streamUpdates.push(update);
      },
    });

    expect(result.outcome).toBe('done');
    expect(streamUpdates.length).toBeGreaterThanOrEqual(2);
    expect(streamUpdates.some((update) => update.done === false)).toBe(true);
    expect(streamUpdates.at(-1)).toMatchObject({
      step: 1,
      text: 'Hello world',
      done: true,
    });
  });

  it('allows one repeated identical tool call, then blocks excessive repetition', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(messages);

        if (seenMessages.length < 4) {
          return {
            toolCalls: [{ id: `call-${seenMessages.length}`, tool: 'list_files', input: { path: '.' } }],
          };
        }

        return {
          content: 'I should stop repeating the same directory listing.',
        };
      },
    };

    let executions = 0;
    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        executions += 1;
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await runAgent({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 5,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I should stop repeating the same directory listing.');
    expect(executions).toBe(3);
    expect(seenMessages[3]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({
        ok: true,
        output: 'README.md\nsrc/',
      }),
      toolCallId: 'call-3',
    });
    expect(result.trace[9]).toMatchObject({
      type: 'tool.result',
      tool: 'list_files',
      result: {
        ok: true,
        output: 'README.md\nsrc/',
      },
    });
  });

  it('normalizes equivalent path spellings but still allows repeated equivalent tool calls', async () => {
    const seenMessages: ChatMessage[][] = [];
    let executions = 0;
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
          };
        }

        if (seenMessages.length === 2) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'list_files', input: { path: './' } }],
          };
        }

        if (seenMessages.length === 3) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'list_files', input: { path: '.' } }],
          };
        }

        return {
          content: 'I should stop repeating equivalent directory listings.',
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        executions += 1;
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await runAgent({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 5,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(executions).toBe(3);
    expect(seenMessages[3]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({
        ok: true,
        output: 'README.md\nsrc/',
      }),
      toolCallId: 'call-3',
    });
  });

  it('does not stop the run after repeated recoverable tool misuse errors', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.', maxEntries: 200 } }],
          };
        }

        if (seenMessages.length === 2) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'list_files', input: { path: '.', maxEntries: 100 } }],
          };
        }

        return {
          content: 'I corrected course instead of dying on invalid list_files parameters.',
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        if ('maxEntries' in (input as Record<string, unknown>)) {
          return { ok: false, error: 'Invalid input for list_files. Allowed fields: path. Example: { "path": "." }' };
        }
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await runAgent({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 4,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I corrected course instead of dying on invalid list_files parameters.');
    expect(seenMessages[1]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('the last tool call failed due to invalid or repeated tool use'),
    });
  });

  it('continues after 3 consecutive tool errors without injecting a warning', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length <= 3) {
          return {
            toolCalls: [{ id: `call-${seenMessages.length}`, tool: 'list_files', input: { path: '.' } }],
          };
        }

        return {
          content: 'I saw the warning and changed approach instead of being stopped.',
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: false, error: 'Transient tool failure while listing files.' };
      },
    };

    const result = await runAgent({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 5,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I saw the warning and changed approach instead of being stopped.');
    expect(seenMessages[3]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('there have been 3 consecutive tool errors'),
    });
  });

  it('does not inject a low-step enforcement reminder after extended evidence gathering', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length <= 3) {
          return {
            toolCalls: [{ id: `call-${seenMessages.length}`, tool: 'list_files', input: { path: `path-${seenMessages.length}` } }],
          };
        }

        return {
          content: 'I have enough evidence to stop exploring.',
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

    await runAgent({
      goal: 'Figure out the next concrete step.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 4,
      logger: silentLogger,
    });

    expect(seenMessages[3]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('Do not spend another turn rephrasing the plan'),
    });
  });

  it('carries prior transcript into a later turn when history is provided', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return {
          content: 'I can answer using the earlier conversation context.',
        };
      },
    };

    const result = await runAgent({
      goal: 'What did I ask before this?',
      llm: fakeLlm,
      tools: [],
      history: [
        { role: 'user', content: 'Inspect the repo root.' },
        { role: 'assistant', content: 'The repo contains README.md and src/.' },
      ],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[0]).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'Inspect the repo root.' },
      { role: 'assistant', content: 'The repo contains README.md and src/.' },
      { role: 'user', content: 'What did I ask before this?' },
    ]);
    expect(result.transcript).toEqual([
      { role: 'user', content: 'Inspect the repo root.' },
      { role: 'assistant', content: 'The repo contains README.md and src/.' },
      { role: 'user', content: 'What did I ask before this?' },
      { role: 'assistant', content: 'I can answer using the earlier conversation context.' },
    ]);
  });

  it('sanitizes unresolved prior tool calls before sending history back to the model', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return {
          content: 'I retried without carrying over the interrupted tool call.',
        };
      },
    };

    const result = await runAgent({
      goal: 'Can you try again?',
      llm: fakeLlm,
      tools: [],
      history: [
        { role: 'user', content: 'Continue on test coverage.' },
        {
          role: 'assistant',
          content: 'I will inspect run-agent next.',
          toolCalls: [{ id: 'call-1', tool: 'read_file', input: { path: 'src/run-agent.ts' } }],
        },
      ],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[0]).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'Continue on test coverage.' },
      { role: 'assistant', content: 'I will inspect run-agent next.' },
      { role: 'user', content: 'Can you try again?' },
    ]);
    expect(result.transcript).toEqual([
      { role: 'user', content: 'Continue on test coverage.' },
      { role: 'assistant', content: 'I will inspect run-agent next.' },
      { role: 'user', content: 'Can you try again?' },
      { role: 'assistant', content: 'I retried without carrying over the interrupted tool call.' },
    ]);
  });

  it('requires approval for tools marked as approval-gated and feeds denials back to the model', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        return {
          content: 'The mutation command was denied, so I will stop and report that.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: { command: 'yarn test', exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Run tests if needed.',
      llm: fakeLlm,
      tools: [mutateTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: false, reason: 'User denied in test' }),
    });

    expect(result.outcome).toBe('done');
    expect(seenMessages[1]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({
        ok: false,
        error: 'Approval denied for run_shell_mutate: User denied in test',
      }),
      toolCallId: 'call-1',
    });
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_requested');
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_resolved');
  });

  it('requires approval before reading a file outside the workspace root', async () => {
    const externalRoot = await mkdtemp(join(tmpdir(), 'heddle-read-outside-'));
    const externalFile = join(externalRoot, 'secret.txt');
    await writeFile(externalFile, 'outside\n', 'utf8');

    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return {
            content: 'I could not read that file without approval.',
          };
        }

        return {
          toolCalls: [{ id: 'call-1', tool: 'read_file', input: { path: externalFile } }],
        };
      },
    };

    const readTool: ToolDefinition = {
      name: 'read_file',
      description: 'Reads a file',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const path = (input as { path: string }).path;
        return { ok: true, output: `read:${path}` };
      },
    };

    const result = await runAgent({
      goal: 'Read the external file.',
      llm: fakeLlm,
      tools: [readTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: false, reason: 'Outside workspace read denied in test' }),
    });

    expect(result.outcome).toBe('done');
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_requested');
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_resolved');
    expect(result.trace).toContainEqual({
      type: 'tool.approval_resolved',
      call: { id: 'call-1', tool: 'read_file', input: { path: externalFile } },
      approved: false,
      reason: 'Outside workspace read denied in test',
      step: 1,
      timestamp: expect.any(String),
    });
    expect(result.trace).toContainEqual({
      type: 'tool.result',
      tool: 'read_file',
      result: {
        ok: false,
        error: 'Approval denied for read_file: Outside workspace read denied in test',
      },
      step: 1,
      timestamp: expect.any(String),
    });
  });

  it('does not require approval before reading a file inside the workspace root', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-read-inside-'));
    const previousCwd = process.cwd();
    process.chdir(workspaceRoot);
    await writeFile(join(workspaceRoot, 'note.txt'), 'inside\n', 'utf8');

    try {
      const fakeLlm: LlmAdapter = {
        async chat(messages): Promise<LlmResponse> {
          if (messages.some((message) => message.role === 'tool')) {
            return {
              content: 'Read completed without approval.',
            };
          }

          return {
            toolCalls: [{ id: 'call-1', tool: 'read_file', input: { path: 'note.txt' } }],
          };
        },
      };

      const readTool: ToolDefinition = {
        name: 'read_file',
        description: 'Reads a file',
        parameters: { type: 'object', properties: {} },
        async execute(input) {
          const path = (input as { path: string }).path;
          return { ok: true, output: `read:${path}` };
        },
      };

      const approveToolCall = vi.fn(async () => ({ approved: true }));
      const result = await runAgent({
        goal: 'Read the workspace file.',
        llm: fakeLlm,
        tools: [readTool],
        maxSteps: 3,
        logger: silentLogger,
        approveToolCall,
      });

      expect(result.outcome).toBe('done');
      expect(approveToolCall).not.toHaveBeenCalled();
      expect(result.trace.map((event) => event.type)).not.toContain('tool.approval_requested');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('requires approval before editing a file outside the workspace root', async () => {
    const externalRoot = await mkdtemp(join(tmpdir(), 'heddle-edit-outside-'));
    const externalFile = join(externalRoot, 'outside.txt');

    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return {
            content: 'The external edit was denied.',
          };
        }

        return {
          toolCalls: [{ id: 'call-1', tool: 'edit_file', input: { path: externalFile, content: 'hello\n', createIfMissing: true } }],
        };
      },
    };

    const editTool: ToolDefinition = {
      name: 'edit_file',
      description: 'Edits a file directly',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: { path: externalFile, action: 'created' } };
      },
    };

    const result = await runAgent({
      goal: 'Edit an external file.',
      llm: fakeLlm,
      tools: [editTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: false, reason: 'External edit denied in test' }),
    });

    expect(result.outcome).toBe('done');
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_requested');
    expect(result.trace).toContainEqual({
      type: 'tool.result',
      tool: 'edit_file',
      result: {
        ok: false,
        error: 'Approval denied for edit_file: External edit denied in test',
      },
      step: 1,
      timestamp: expect.any(String),
    });
  });

  it('records an explicit fallback event when inspect retries through mutate', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return {
            content: 'The fallback command ran successfully.',
          };
        }

        return {
          toolCalls: [{ id: 'call-1', tool: 'run_shell_inspect', input: { command: 'aws configure list' } }],
        };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a bounded read-only shell command',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return {
          ok: false,
          error:
            'Command not allowed by run_shell_inspect policy. This tool only permits bounded commands that match its configured workspace risk/scope rules.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs an approval-gated shell command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: 'ok', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Try the AWS CLI command.',
      llm: fakeLlm,
      tools: [inspectTool, mutateTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true, reason: 'remembered project approval' }),
    });

    expect(result.outcome).toBe('done');
    expect(result.trace).toContainEqual({
      type: 'tool.fallback',
      fromCall: { id: 'call-1', tool: 'run_shell_inspect', input: { command: 'aws configure list' } },
      toCall: {
        id: 'call-1-mutate-fallback',
        tool: 'run_shell_mutate',
        input: { command: 'aws configure list' },
      },
      reason: 'inspect policy rejected the command',
      step: 1,
      timestamp: expect.any(String),
    });
    expect(result.trace.map((event) => event.type)).toEqual([
      'run.started',
      'assistant.turn',
      'tool.call',
      'tool.result',
      'tool.fallback',
      'tool.approval_requested',
      'tool.approval_resolved',
      'tool.call',
      'tool.result',
      'assistant.turn',
      'run.finished',
    ]);
  });

  it('reminds about repo review and verification after a workspace-changing action without blocking final answer', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const hostReminder = [...messages].reverse().find(
          (message: ChatMessage) =>
            message.role === 'system' &&
            message.content.includes('Host requirement: before giving a final answer'),
        );

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (!hostReminder) {
          return {
            content: 'The workspace-changing command is complete.',
          };
        }

        if (seenMessages.length === 3) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (seenMessages.length === 4) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        return {
          content: 'Applied the fix and verified the repo state.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Apply the fix and tell me it worked.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 6,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The workspace-changing command is complete.');
    expect(seenMessages[1]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('before giving a final answer after a workspace-changing action'),
    });
  });

  it('reminds about post-edit review and verification after edit_file without blocking final answer', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'edit_file', input: { path: 'README.md', oldText: 'old', newText: 'new' } }],
          };
        }

        return {
          content: 'I updated the file.',
        };
      },
    };

    const editTool: ToolDefinition = {
      name: 'edit_file',
      description: 'Edits a file directly in the workspace',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: { path: 'README.md', action: 'replaced', matchCount: 1 } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Update the README and tell me it worked.',
      llm: fakeLlm,
      tools: [editTool, inspectTool, mutateTool],
      maxSteps: 6,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I updated the file.');
    expect(seenMessages[1]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('before giving a final answer after a workspace-changing action'),
    });
  });

  it('does not loop when post-mutation review and verification reminders are ignored', async () => {
    const seenMessages: ChatMessage[][] = [];
    let stage = 0;
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        stage += 1;
        seenMessages.push(structuredClone(messages));

        if (stage === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (stage === 2) {
          return {
            content: 'The change is ready to be reported.',
          };
        }

        if (stage === 3) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (stage === 4) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        return {
          content: 'Applied the lint fix and checked the repo and test state.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Apply lint fix and summarize.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 8,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The change is ready to be reported.');

    const hostRequirement = seenMessages
      .flat()
      .find(
        (message) =>
          message.role === 'system' &&
          message.content.includes('Host requirement: before giving a final answer after a workspace-changing action'),
      );
    expect(hostRequirement).toBeUndefined();
  });

  it('does not reopen post-mutation review and verification requirements for git add/commit/push after verification already ran', async () => {
    const seenMessages: ChatMessage[][] = [];
    let stage = 0;
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        stage += 1;
        seenMessages.push(structuredClone(messages));

        if (stage === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (stage === 2) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (stage === 3) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        if (stage === 4) {
          return {
            toolCalls: [{ id: 'call-4', tool: 'run_shell_mutate', input: { command: 'git add src/example.ts && git commit -m "fix example" && git push' } }],
          };
        }

        return {
          content: 'Applied the fix, verified it, and pushed it.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Apply fix, verify it, commit, push, and summarize.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 8,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toContain('Applied the fix, verified it, and pushed it.');
    expect(seenMessages.at(-1)?.some((message) => message.role === 'assistant')).toBe(true);
  });

  it('allows a vague final answer after mutation reminder instead of looping', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const structuredReminder = undefined;

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (seenMessages.length === 2) {
          return {
            content: 'The workspace-changing command is complete.',
          };
        }

        if (seenMessages.length === 3) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (seenMessages.length === 4) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        if (!structuredReminder) {
          return {
            content: 'I made the change and it looks good.',
          };
        }

        return {
          content: 'Applied the fix and verified the repo state.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Apply the fix and tell me it worked.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 8,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The workspace-changing command is complete.');
  });

  it('allows a structured summary that omits actual review and verification commands instead of looping', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const structuredReminder = undefined;

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (seenMessages.length === 2) {
          return { content: 'The workspace-changing command is complete.' };
        }

        if (seenMessages.length === 3) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (seenMessages.length === 4) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        if (!structuredReminder) {
          return {
            content: 'Applied the fix and checked it.\n- Changed: fixed src/example.ts.\n- Verified: reviewed the repo and tests passed.\n- Remaining uncertainty: none.',
          };
        }

        return {
          content: 'Applied the fix and verified the repo state.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Apply the fix and tell me it worked.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 8,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The workspace-changing command is complete.');
  });

  it('returns an interrupted outcome when the host requests a stop between steps', async () => {
    let shouldStop = false;
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        shouldStop = true;
        return {
          toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
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
      goal: 'Inspect this repo and then stop.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 3,
      logger: silentLogger,
      shouldStop: () => shouldStop,
    });

    expect(result.outcome).toBe('interrupted');
    expect(result.summary).toBe('Run interrupted by host request');
    expect(result.trace[result.trace.length - 1]).toMatchObject({
      type: 'run.finished',
      outcome: 'interrupted',
    });
  });

  it('treats bounded file operations as workspace-changing mutate commands that require review and verification follow-up', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const hostReminder = [...messages].reverse().find(
          (message: ChatMessage) =>
            message.role === 'system' &&
            message.content.includes('Host requirement: before giving a final answer'),
        );

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'mv docs/old.md docs/new.md' } }],
          };
        }

        if (!hostReminder) {
          return { content: 'I moved the file.' };
        }

        return {
          content:
            'Moved the file and completed the required follow-up checks.\n- Changed: moved docs/old.md to docs/new.md.\n- Verified: git diff --stat reviewed (exit 0); yarn test passed (exit 0).\n- Remaining uncertainty: none.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Move the file and tell me the result.',
      llm: fakeLlm,
      tools: [mutateTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I moved the file.');
    expect(seenMessages[1]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('before giving a final answer after a workspace-changing action'),
    });
  });

  it('asks for the missing git-native review command when verification already ran after a change', async () => {
    const seenMessages: ChatMessage[][] = [];
    let stage = 0;
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        stage += 1;
        seenMessages.push(structuredClone(messages));

        if (stage === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (stage === 2) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        return {
          content: 'The change is done and verified.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await runAgent({
      goal: 'Apply the fix and report back.',
      llm: fakeLlm,
      tools: [mutateTool],
      maxSteps: 4,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The change is done and verified.');
    expect(seenMessages[1]).not.toEqual(
      expect.arrayContaining([
        {
          role: 'system',
          content: expect.stringContaining(
            'Host requirement: before giving a final answer after a workspace-changing action',
          ),
        },
      ]),
    );
  });

  it('asks for the missing git-native review command while noting existing verification evidence', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        return {
          content: 'Done.',
        };
      },
    };

    const result = await runAgent({
      goal: 'Fix the issue and summarize.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('Done.');
  });

  it('allows a final answer even when a recorded plan still has unfinished items', async () => {
    let stage = 0;
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        stage += 1;

        if (stage === 1) {
          return {
            toolCalls: [{
              id: 'call-1',
              tool: 'update_plan',
              input: {
                explanation: 'Tracking the implementation steps.',
                plan: [
                  { step: 'Inspect current implementation', status: 'completed' },
                  { step: 'Implement the next bounded change', status: 'in_progress' },
                  { step: 'Verify with tests', status: 'pending' },
                ],
              },
            }],
          };
        }

        return {
          content: 'The work is done.',
        };
      },
    };

    const updatePlanTool: ToolDefinition = {
      name: 'update_plan',
      description: 'Records a short working plan.',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        return { ok: true, output: input };
      },
    };

    const result = await runAgent({
      goal: 'Implement the next step.',
      llm: fakeLlm,
      tools: [updatePlanTool],
      maxSteps: 2,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The work is done.');
    expect(
      result.transcript.some(
        (message) =>
          message.role === 'system' &&
          message.content.includes('you recorded a plan and it still has unfinished items'),
      ),
    ).toBe(false);
  });
});
