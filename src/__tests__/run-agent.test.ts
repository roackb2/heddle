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
      maxSteps: 5,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I should stop repeating the same directory listing.');
    expect(seenMessages[3]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({
        ok: false,
        error:
          'Repeated tool call blocked: list_files was already called 2 times with the same input earlier in this run. Try a different tool or different input.',
      }),
      toolCallId: 'call-3',
    });
    expect(result.trace[9]).toMatchObject({
      type: 'tool.result',
      tool: 'list_files',
      result: {
        ok: false,
        error:
          'Repeated tool call blocked: list_files was already called 2 times with the same input earlier in this run. Try a different tool or different input.',
      },
    });
  });

  it('normalizes equivalent path spellings and only blocks them after repeated retries', async () => {
    const seenMessages: ChatMessage[][] = [];
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
    expect(seenMessages[3]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({
        ok: false,
        error:
          'Repeated tool call blocked: list_files was already called 2 times with the same input earlier in this run. Try a different tool or different input.',
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
    expect(seenMessages[1]).toContainEqual({
      role: 'system',
      content:
        'Host reminder: the last tool call failed due to invalid or repeated tool use: Invalid input for list_files. Allowed fields: path. Example: { "path": "." }. Correct the call immediately, switch tools, or use report_state if you are blocked. Do not keep retrying the same failing pattern.',
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

  it('requires repo review and verification before finalizing after a workspace-changing mutate command', async () => {
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
          content:
            'Changed: fixed src/example.ts via eslint --fix.\nVerified: reviewed git diff --stat and yarn test passed.\nRemaining uncertainty: none.',
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
    expect(result.summary).toBe(
      'Changed: fixed src/example.ts via eslint --fix.\nVerified: reviewed git diff --stat and yarn test passed.\nRemaining uncertainty: none.',
    );
    expect(seenMessages[2]).toContainEqual({
      role: 'system',
      content:
        'Host requirement: before giving a final answer after a workspace-changing mutate command, you must inspect the resulting repo state with a git review command such as git status or git diff and run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc. After doing that, then provide the final answer.',
    });
  });

  it('rejects a vague final answer after mutation follow-up until it includes changed, verified, and remaining uncertainty labels', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const structuredReminder = [...messages].reverse().find(
          (message: ChatMessage) =>
            message.role === 'system' &&
            message.content.includes('your final answer must be a short operator review'),
        );

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
          content:
            'Changed: fixed src/example.ts via eslint --fix.\nVerified: reviewed git diff --stat and yarn test passed.\nRemaining uncertainty: none.',
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
    expect(result.summary).toBe(
      'Changed: fixed src/example.ts via eslint --fix.\nVerified: reviewed git diff --stat and yarn test passed.\nRemaining uncertainty: none.',
    );
    expect(seenMessages[5]).toContainEqual({
      role: 'system',
      content:
        'Host requirement: after a workspace-changing mutate command, your final answer must be a short operator review with exactly these labels on separate lines: "Changed:", "Verified:", and "Remaining uncertainty:". Mention the concrete change work (eslint --fix src/example.ts), the repo review evidence (git diff --stat), and the verification evidence (yarn test). If nothing remains uncertain, explicitly write "Remaining uncertainty: none".',
    });
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
            'Changed: moved docs/old.md to docs/new.md.\nVerified: reviewed git diff --stat and yarn test passed.\nRemaining uncertainty: none.',
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

    expect(result.outcome).toBe('max_steps');
    expect(seenMessages[2]).toContainEqual({
      role: 'system',
      content:
        'Host requirement: before giving a final answer after a workspace-changing mutate command, you must inspect the resulting repo state with a git review command such as git status or git diff and run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc. After doing that, then provide the final answer.',
    });
  });
});
