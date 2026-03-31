import { describe, it, expect } from 'vitest';
import { runAgent } from '../run-agent.js';
import type { ChatMessage, LlmAdapter, LlmResponse } from '../llm/types.js';
import type { ToolDefinition } from '../types.js';
import { createLogger } from '../utils/logger.js';

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

  it('blocks duplicate tool calls with identical input and feeds the error back to the model', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(messages);

        if (seenMessages.length < 3) {
          return {
            toolCalls: [{ id: `call-${seenMessages.length}`, tool: 'list_files', input: { path: '.' } }],
          };
        }

        return {
          content: 'I should stop repeating the same directory listing.',
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
      maxSteps: 4,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I should stop repeating the same directory listing.');
    expect(seenMessages[2]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({
        ok: false,
        error:
          'Duplicate tool call blocked: list_files was already called with the same input earlier in this run. Try a different tool or different input.',
      }),
      toolCallId: 'call-2',
    });
    expect(result.trace[6]).toMatchObject({
      type: 'tool.result',
      tool: 'list_files',
      result: {
        ok: false,
        error:
          'Duplicate tool call blocked: list_files was already called with the same input earlier in this run. Try a different tool or different input.',
      },
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
});
