import { describe, expect, it, vi } from 'vitest';
import type { ControlPlaneSessionView } from '../../../client-shared/api/types.js';
import {
  TerminalSlashCommandService,
  type TerminalSlashCommandContext,
} from '../../../cli-v2/services/commands/terminal-slash-command-service.js';
import { TerminalSlashCommandParser } from '../../../cli-v2/services/commands/terminal-slash-command-parser.js';
import { TerminalSlashCommandRegistry } from '../../../cli-v2/services/commands/terminal-slash-command-registry.js';
import type { TerminalSlashCommandModule } from '../../../cli-v2/services/commands/types.js';

describe('TerminalSlashCommandService', () => {
  it('parses terminal slash commands without treating absolute paths as commands', () => {
    expect(TerminalSlashCommandParser.parse('  /new Slice  ')).toEqual({
      raw: '/new Slice',
      root: '/new',
      rest: 'Slice',
    });
    expect(TerminalSlashCommandParser.parse('/Users/me/screenshot.png')).toBeUndefined();
  });

  it('publishes module-owned hints through the registry', async () => {
    const registry = new TerminalSlashCommandRegistry([createTestCommandModule()]);

    expect(registry.hints()).toEqual([
      { command: '/test', description: 'run test command' },
    ]);
    await expect(registry.execute(createContext(), '/test')).resolves.toEqual({
      handled: true,
      status: {
        label: 'Test command',
        tone: 'info',
      },
    });
  });

  it('rejects duplicate command module ids', () => {
    expect(() => new TerminalSlashCommandRegistry([
      createTestCommandModule(),
      createTestCommandModule(),
    ])).toThrow('Duplicate cli-v2 slash command module id: test');
  });

  it('does not handle regular prompts', async () => {
    const service = new TerminalSlashCommandService();

    await expect(service.execute('Build the next slice', createContext())).resolves.toEqual({ handled: false });
  });

  it('lists supported commands for /help', async () => {
    const service = new TerminalSlashCommandService();

    const result = await service.execute('/help', createContext());

    expect(result).toMatchObject({
      handled: true,
      status: {
        label: 'CLI v2 commands',
        tone: 'info',
      },
    });
    expect(result.handled && result.status?.detail).toContain('/new [name]');
  });

  it('returns a visible error for unknown slash commands', async () => {
    const service = new TerminalSlashCommandService();

    await expect(service.execute('/whatever', createContext())).resolves.toEqual({
      handled: true,
      error: 'Unknown cli-v2 slash command: /whatever. Use /help to inspect supported commands.',
    });
  });

  it('creates and selects a new session through the command context', async () => {
    const service = new TerminalSlashCommandService();
    const context = createContext();

    const result = await service.execute('/new Refactor slice', context);

    expect(context.createSession).toHaveBeenCalledWith({ name: 'Refactor slice' });
    expect(context.selectSession).toHaveBeenCalledWith('session-2');
    expect(result).toEqual({
      handled: true,
      status: {
        label: 'Created new session',
        detail: 'Refactor slice',
        tone: 'success',
      },
    });
  });

  it('blocks mutating commands while a run is active', async () => {
    const service = new TerminalSlashCommandService();
    const context = createContext({ isRunActive: true });

    await expect(service.execute('/new', context)).resolves.toEqual({
      handled: true,
      error: 'Cannot create a new session while the current run is active.',
    });
    expect(context.createSession).not.toHaveBeenCalled();
  });

  it('refreshes and formats sessions for /sessions', async () => {
    const service = new TerminalSlashCommandService();
    const context = createContext();

    const result = await service.execute('/sessions', context);

    expect(context.refreshSessions).toHaveBeenCalled();
    expect(result).toMatchObject({
      handled: true,
      status: {
        label: 'Sessions refreshed',
        detail: '* Session 1 (session-1)\nRefactor slice (session-2)',
        tone: 'info',
      },
    });
  });
});

function createTestCommandModule(): TerminalSlashCommandModule {
  return {
    id: 'test',
    hints: [
      { command: '/test', description: 'run test command' },
    ],
    commands: [
      {
        id: 'test.run',
        syntax: '/test',
        description: 'run test command',
        match: TerminalSlashCommandParser.matchesExact('/test'),
        execute: () => ({
          handled: true,
          status: {
            label: 'Test command',
            tone: 'info',
          },
        }),
      },
    ],
  };
}

function createContext(options: { isRunActive?: boolean } = {}): TerminalSlashCommandContext {
  const sessions = createSessions();
  return {
    activeSessionId: 'session-1',
    isRunActive: options.isRunActive ?? false,
    refreshSessions: vi.fn(async () => sessions),
    createSession: vi.fn(async (input) => ({
      id: 'session-2',
      name: input.name ?? 'New session',
      workspaceId: 'workspace-1',
      messageCount: 0,
      turnCount: 0,
    })),
    selectSession: vi.fn(async () => undefined),
  };
}

function createSessions(): ControlPlaneSessionView[] {
  return [
    {
      id: 'session-1',
      name: 'Session 1',
      workspaceId: 'workspace-1',
      messageCount: 1,
      turnCount: 0,
    },
    {
      id: 'session-2',
      name: 'Refactor slice',
      workspaceId: 'workspace-1',
      messageCount: 0,
      turnCount: 0,
    },
  ];
}
