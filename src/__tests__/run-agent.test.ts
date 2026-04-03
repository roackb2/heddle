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

  it('adds a follow-through reminder after report_state so the next turn acts on the named blocker', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{
              id: 'call-1',
              tool: 'report_state',
              input: {
                rationale: 'Need a more precise file slice before editing.',
                missing: ['A specific line range from src/run-agent.ts'],
                nextNeed: 'read_file on src/run-agent.ts with offset 200 and maxLines 80',
              },
            }],
          };
        }

        return {
          content: 'I will act on the concrete blocker next.',
        };
      },
    };

    const reportStateTool: ToolDefinition = {
      name: 'report_state',
      description: 'Records the current blocker',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        return { ok: true, output: input };
      },
    };

    await runAgent({
      goal: 'Investigate the next implementation step.',
      llm: fakeLlm,
      tools: [reportStateTool],
      maxSteps: 2,
      logger: silentLogger,
    });

    expect(seenMessages[1]).toContainEqual({
      role: 'system',
      content:
        'Host reminder: report_state is only a checkpoint. On the next turn, either do the concrete nextNeed you identified (read_file on src/run-agent.ts with offset 200 and maxLines 80) or finish with the best grounded blocker. Do not repeat the same planning state.',
    });
  });

  it('adds a low-step reminder after extended evidence gathering so the run converges instead of drifting', async () => {
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

    expect(seenMessages[3]).toContainEqual({
      role: 'system',
      content:
        'Host reminder: only 1 step(s) remain. Do not spend another turn rephrasing the plan. Either execute the single next concrete action needed to finish, or answer with the best grounded blocker.',
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
            'Applied the fix and verified the repo state.\n- Changed: fixed src/example.ts via eslint --fix src/example.ts.\n- Verified: reviewed git diff --stat and yarn test passed.\n- Remaining uncertainty: none.',
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
      'Applied the fix and verified the repo state.\n- Changed: fixed src/example.ts via eslint --fix src/example.ts.\n- Verified: reviewed git diff --stat and yarn test passed.\n- Remaining uncertainty: none.',
    );
    expect(seenMessages[2]).toContainEqual({
      role: 'system',
      content:
        'Host requirement: before giving a final answer after a workspace-changing mutate command, you must inspect the resulting repo state with concrete git review evidence such as git status --short or git diff --stat and run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc. After doing that, then provide the final answer.',
    });
  });

  it('treats edit_file as a workspace-changing action that requires review and verification follow-up', async () => {
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
            toolCalls: [{ id: 'call-1', tool: 'edit_file', input: { path: 'README.md', oldText: 'old', newText: 'new' } }],
          };
        }

        if (!hostReminder) {
          return {
            content: 'I updated the file.',
          };
        }

        return {
          content:
            'Updated the README and verified the follow-up steps.\n- Changed: updated README.md via edit_file.\n- Verified: reviewed git diff --stat and yarn test passed.\n- Remaining uncertainty: none.',
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

    const result = await runAgent({
      goal: 'Update the README and tell me it worked.',
      llm: fakeLlm,
      tools: [editTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('max_steps');
    expect(seenMessages[2]).toContainEqual({
      role: 'system',
      content:
        'Host requirement: before giving a final answer after a workspace-changing mutate command, you must inspect the resulting repo state with concrete git review evidence such as git status --short or git diff --stat and run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc. After doing that, then provide the final answer.',
    });
  });

  it('requires post-mutation review, verification, and structured summary before finishing', async () => {
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
          content:
            'Applied the lint fix and checked the repo and test state.\n- Changed: eslint --fix src/example.ts applied to src/example.ts.\n- Verified: git diff --stat => exit 0, no stdout/stderr output; yarn test => exit 0, no stdout/stderr output.\n- Remaining uncertainty: none.',
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
    expect(result.summary).toBe(
      'Applied the lint fix and checked the repo and test state.\n- Changed: eslint --fix src/example.ts applied to src/example.ts.\n- Verified: git diff --stat => exit 0, no stdout/stderr output; yarn test => exit 0, no stdout/stderr output.\n- Remaining uncertainty: none.',
    );

    const hostRequirement = seenMessages
      .flat()
      .find(
        (message) =>
          message.role === 'system' &&
          message.content.includes('Host requirement: before giving a final answer after a workspace-changing mutate command'),
      );
    expect(hostRequirement).toBeDefined();
    expect(hostRequirement?.content).toContain(
      'Host requirement: before giving a final answer after a workspace-changing mutate command',
    );
  });

  it('rejects a vague final answer after mutation follow-up until it includes changed, verified, and remaining uncertainty labels', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const structuredReminder = [...messages].reverse().find(
          (message: ChatMessage) =>
            message.role === 'system' &&
            message.content.includes('your final answer must start with a short summary sentence or short paragraph'),
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
            'Applied the fix and verified the repo state.\n- Changed: fixed src/example.ts via eslint --fix src/example.ts.\n- Verified: reviewed git diff --stat and yarn test passed.\n- Remaining uncertainty: none.',
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
      'Applied the fix and verified the repo state.\n- Changed: fixed src/example.ts via eslint --fix src/example.ts.\n- Verified: reviewed git diff --stat and yarn test passed.\n- Remaining uncertainty: none.',
    );
    expect(seenMessages[5]).toContainEqual({
      role: 'system',
      content:
        'Host requirement: after a workspace-changing mutate command, your final answer must start with a short summary sentence or short paragraph, then include bullet points labeled "Changed:", "Verified:", and "Remaining uncertainty:". In "Changed:", mention the concrete change work and name the exact command(s) or edit action used (eslint --fix src/example.ts). In "Verified:", name the exact repo review command(s) (git diff --stat) and exact verification command(s) (yarn test), and ground them in concrete evidence from the command results (git diff --stat => exit 0, no stdout/stderr output; yarn test => exit 0, no stdout/stderr output). If nothing remains uncertain, explicitly write "Remaining uncertainty: none".',
    });
  });

  it('rejects a structured summary that omits the actual review and verification commands', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const structuredReminder = [...messages].reverse().find(
          (message: ChatMessage) =>
            message.role === 'system' &&
            message.content.includes('your final answer must start with a short summary sentence or short paragraph'),
        );

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
          content:
            'Applied the fix and verified the repo state.\n- Changed: fixed src/example.ts via eslint --fix src/example.ts.\n- Verified: reviewed git diff --stat and yarn test passed.\n- Remaining uncertainty: none.',
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
      'Applied the fix and verified the repo state.\n- Changed: fixed src/example.ts via eslint --fix src/example.ts.\n- Verified: reviewed git diff --stat and yarn test passed.\n- Remaining uncertainty: none.',
    );
    expect(seenMessages[5]).toContainEqual({
      role: 'system',
      content:
        'Host requirement: after a workspace-changing mutate command, your final answer must start with a short summary sentence or short paragraph, then include bullet points labeled "Changed:", "Verified:", and "Remaining uncertainty:". In "Changed:", mention the concrete change work and name the exact command(s) or edit action used (eslint --fix src/example.ts). In "Verified:", name the exact repo review command(s) (git diff --stat) and exact verification command(s) (yarn test), and ground them in concrete evidence from the command results (git diff --stat => exit 0, no stdout/stderr output; yarn test => exit 0, no stdout/stderr output). If nothing remains uncertain, explicitly write "Remaining uncertainty: none".',
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
            'Moved the file and completed the required follow-up checks.\n- Changed: moved docs/old.md to docs/new.md.\n- Verified: reviewed git diff --stat and yarn test passed.\n- Remaining uncertainty: none.',
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
        'Host requirement: before giving a final answer after a workspace-changing mutate command, you must inspect the resulting repo state with concrete git review evidence such as git status --short or git diff --stat and run a verification command such as yarn test, yarn build, yarn lint, vitest, or tsc. After doing that, then provide the final answer.',
    });
  });
});
