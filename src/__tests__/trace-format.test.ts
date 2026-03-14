import { describe, it, expect } from 'vitest';
import { formatTraceForConsole } from '../trace/format.js';

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

  it('renders structured tool outputs readably instead of object coercions', () => {
    const output = formatTraceForConsole([
      {
        type: 'tool.result',
        tool: 'run_shell',
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

    expect(output).toContain('run_shell');
    expect(output).toContain('"command": "pwd"');
    expect(output).toContain('"stdout": "/repo"');
    expect(output).not.toContain('[object Object]');
  });
});
