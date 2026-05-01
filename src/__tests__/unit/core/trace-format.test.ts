import { describe, it, expect } from 'vitest';
import { formatTraceForConsole } from '../../../core/trace/format.js';

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

  it('renders assistant diagnostics for missing gaps and desired tools', () => {
    const output = formatTraceForConsole([
      {
        type: 'assistant.turn',
        content: 'I need to inspect the environment before answering.',
        diagnostics: {
          missing: ['Need the current directory contents'],
          wantedTools: ['list_files'],
          wantedInputs: ['path=.'],
        },
        requestedTools: true,
        toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
        step: 1,
        timestamp: '2024-01-01T00:00:00Z',
      },
    ]);

    expect(output).toContain('Missing: Need the current directory contents');
    expect(output).toContain('Wanted Tools: list_files');
    expect(output).toContain('Wanted Inputs: path=.');
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

  it('renders host warnings readably', () => {
    const output = formatTraceForConsole([
      {
        type: 'host.warning',
        code: 'actionless_completion',
        message: 'Action-oriented prompt finished with no tool activity; assistant replied with an intent statement instead of taking the next action.',
        details: {
          goal: 'continue on the work',
          responseLead: 'I will continue in the isolated worktree.',
        },
        step: 3,
        timestamp: '2024-01-01T00:00:02Z',
      },
    ]);

    expect(output).toContain('Host Warning:');
    expect(output).toContain('Action-oriented prompt finished with no tool activity');
    expect(output).toContain('"goal":"continue on the work"');
  });

  it('renders structured tool outputs readably instead of object coercions', () => {
    const output = formatTraceForConsole([
      {
        type: 'tool.result',
        tool: 'run_shell_inspect',
        result: {
          ok: true,
          output: {
            command: 'pwd',
            exitCode: 0,
            stdout: '/repo',
            stderr: '',
          },
        },
        step: 2,
        timestamp: '2024-01-01T00:00:01Z',
      },
    ]);

    expect(output).toContain('run_shell_inspect');
    expect(output).toContain('"command": "pwd"');
    expect(output).toContain('"stdout": "/repo"');
    expect(output).not.toContain('[object Object]');
  });

  it('renders approval events readably', () => {
    const output = formatTraceForConsole([
      {
        type: 'tool.approval_requested',
        call: {
          id: 'call-1',
          tool: 'run_shell_mutate',
          input: { command: 'yarn test' },
        },
        step: 2,
        timestamp: '2024-01-01T00:00:01Z',
      },
      {
        type: 'tool.approval_resolved',
        call: {
          id: 'call-1',
          tool: 'run_shell_mutate',
          input: { command: 'yarn test' },
        },
        approved: false,
        reason: 'User denied in test',
        step: 2,
        timestamp: '2024-01-01T00:00:02Z',
      },
    ]);

    expect(output).toContain('Approval Required');
    expect(output).toContain('run_shell_mutate');
    expect(output).toContain('Approval Denied');
    expect(output).toContain('User denied in test');
  });

  it('renders tool fallback events readably', () => {
    const output = formatTraceForConsole([
      {
        type: 'tool.fallback',
        fromCall: {
          id: 'call-1',
          tool: 'run_shell_inspect',
          input: { command: 'aws configure list' },
        },
        toCall: {
          id: 'call-1-mutate-fallback',
          tool: 'run_shell_mutate',
          input: { command: 'aws configure list' },
        },
        reason: 'inspect policy rejected the command',
        step: 2,
        timestamp: '2024-01-01T00:00:03Z',
      },
    ]);

    expect(output).toContain('Tool Fallback');
    expect(output).toContain('run_shell_inspect → run_shell_mutate');
    expect(output).toContain('inspect policy rejected the command');
    expect(output).toContain('"command":"aws configure list"');
  });

  it('renders CyberLoop annotation events readably', () => {
    const output = formatTraceForConsole([
      {
        type: 'cyberloop.annotation',
        step: 3,
        frameKind: 'assistant',
        driftLevel: 'medium',
        requestedHalt: false,
        metadata: {
          kinematics: {
            isStable: false,
            coherenceAngleDeg: 90,
            correctionMagnitude: 1,
          },
        },
        timestamp: '2024-01-01T00:00:03Z',
      },
    ]);

    expect(output).toContain('CyberLoop:');
    expect(output).toContain('drift=medium');
    expect(output).toContain('corr=1.000');
    expect(output).toContain('stable=false');
    expect(output).toContain('coherenceAngleDeg');
  });
});
