import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SlashCommandAutocomplete } from '../../../core/commands/slash/autocomplete.js';
import { browserStatusMessage } from '../../../core/commands/slash/modules/browser/browser-commands.js';
import { createMcpSlashCommandModule, listMcpMessage } from '../../../core/commands/slash/modules/mcp/mcp-commands.js';
import type { SlashCommandExecutionContext } from '../../../core/commands/slash/modules/context.js';
import { listSkillsMessage } from '../../../core/commands/slash/modules/skills/skills-commands.js';
import { SlashCommandParser } from '../../../core/commands/slash/parser.js';
import { SlashCommandRegistry } from '../../../core/commands/slash/registry.js';
import type { AgentSkillActivationView } from '../../../core/skills/index.js';
import type { BrowserAutomationOverview } from '../../../core/browser/index.js';
import type { McpOverview } from '../../../core/mcp/index.js';
import type { SlashCommand, SlashCommandModule } from '../../../core/commands/slash/types.js';

type TestResult = { kind: string; value?: string };
type TestContext = { prefix: string };

const absoluteScreenshotFixturePath = join(process.cwd(), 'src/__tests__/fixtures/screenshot.png');

function command(
  overrides: Partial<SlashCommand<TestResult, TestContext>> & Pick<SlashCommand<TestResult, TestContext>, 'id' | 'syntax'>,
): SlashCommand<TestResult, TestContext> {
  return {
    description: `${overrides.id} description`,
    aliases: [],
    match: SlashCommandParser.matchesExact(overrides.syntax),
    run: (context, input) => ({ kind: overrides.id, value: `${context.prefix}:${input.rest}` }),
    ...overrides,
  };
}

function moduleWith(commands: SlashCommand<TestResult, TestContext>[]): SlashCommandModule<TestResult, TestContext> {
  return {
    id: 'test',
    commands,
  };
}

describe('slash command parser', () => {
  it('parses slash commands into root, tokens, and rest', () => {
    expect(SlashCommandParser.parse('  /model set gpt-5.4  ')).toEqual({
      raw: '/model set gpt-5.4',
      root: 'model',
      tokens: ['model', 'set', 'gpt-5.4'],
      rest: 'set gpt-5.4',
    });
  });

  it('parses the bare slash command as an empty root', () => {
    expect(SlashCommandParser.parse('/')).toEqual({
      raw: '/',
      root: '',
      tokens: [],
      rest: '',
    });
  });

  it('does not treat normal text or absolute Unix paths as slash commands', () => {
    expect(SlashCommandParser.parse('hello')).toBeUndefined();
    expect(SlashCommandParser.parse(absoluteScreenshotFixturePath)).toBeUndefined();
    expect(SlashCommandParser.isInput('/session list')).toBe(true);
    expect(SlashCommandParser.isInput(absoluteScreenshotFixturePath)).toBe(false);
  });

  it('provides exact, alias, and prefix-style match helpers', () => {
    const parsed = SlashCommandParser.parse('/session switch session-a');
    if (!parsed) {
      throw new Error('expected parsed command');
    }

    expect(SlashCommandParser.matchesExact('/session switch session-a')(parsed)).toBe(true);
    expect(SlashCommandParser.matchesExact('/session switch')(parsed)).toBe(false);
    expect(SlashCommandParser.matchesAnyExact(['/session list', '/session switch session-a'])(parsed)).toBe(true);
    expect(SlashCommandParser.matchesPrefix('/session switch')(parsed)).toBe(true);
    expect(SlashCommandParser.matchesPrefix('/session close')(parsed)).toBe(false);
  });
});

describe('MCP slash command output', () => {
  it('groups MCP servers by activation status with refresh actions', async () => {
    const overview: McpOverview = {
      configPath: '/workspace/.heddle/mcp.json',
      activationStorePath: '/workspace/.heddle/mcp/activation.json',
      catalogStorePath: '/workspace/.heddle/mcp/catalog.json',
      issues: [],
      servers: [
        {
          id: 'notion',
          status: 'enabled',
          config: {
            id: 'notion',
            transport: 'stdio',
            source: 'standard',
            command: 'npx',
            args: ['-y', 'notion-mcp'],
            env: {},
          },
          toolCount: 2,
          action: '/mcp disable notion',
          catalog: {
            serverId: 'notion',
            tools: [],
            refreshedAt: '2026-06-08T00:00:00.000Z',
          },
        },
        {
          id: 'anytype',
          status: 'available',
          config: {
            id: 'anytype',
            transport: 'http',
            source: 'standard',
            url: 'https://example.com/mcp',
            headers: {},
          },
          toolCount: 0,
          action: '/mcp enable anytype',
        },
      ],
    };

    await expect(listMcpMessage({
      mcp: {
        list: async () => overview,
        enable: vi.fn(),
        disable: vi.fn(),
        refresh: vi.fn(),
        openConfig: vi.fn(),
      },
    })).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: [
        'MCP Servers',
        'config=/workspace/.heddle/mcp.json',
        '',
        'Enabled (1)',
        '- notion',
        '  transport=stdio',
        '  target=npx -y notion-mcp',
        '  cachedTools=2',
        '  refreshedAt=2026-06-08T00:00:00.000Z',
        '  action=/mcp disable notion',
        'Available (1)',
        '- anytype',
        '  transport=http',
        '  target=https://example.com/mcp',
        '  cachedTools=0',
        '  action=/mcp enable anytype',
        'Disabled (0)',
        '  none',
        'Missing config (0)',
        '  none',
        '',
        'Commands',
        '  /mcp config',
        '  /mcp enable <server>',
        '  /mcp disable <server>',
        '  /mcp refresh <server>',
      ].join('\n'),
    });
  });

  it('opens the MCP config file through the slash context', async () => {
    const openConfig = vi.fn(async () => ({
      ok: true as const,
      configPath: '/workspace/.heddle/mcp.json',
      command: 'open /workspace/.heddle/mcp.json',
    }));
    const registry = new SlashCommandRegistry([createMcpSlashCommandModule()]);
    const context = {
      mcp: {
        list: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        refresh: vi.fn(),
        openConfig,
      },
    } as Pick<SlashCommandExecutionContext, 'mcp'> as SlashCommandExecutionContext;

    await expect(registry.run(context, '/mcp config')).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Opened MCP config: /workspace/.heddle/mcp.json',
    });
  });
});

describe('Browser Automation slash command output', () => {
  it('reports capability status and activation commands', async () => {
    const overview: BrowserAutomationOverview = {
      enabled: false,
      skillName: 'browser-automation',
      activationStorePath: '/workspace/.heddle/skills/activation.json',
      skill: {
        name: 'browser-automation',
        status: 'available',
      },
      profileRequirement: 'Logged-in sites require a selected profile.',
      toolAvailability: 'Browser tools remain host-controlled.',
    };

    await expect(browserStatusMessage({
      browserAutomation: {
        overview: async () => overview,
        setEnabled: vi.fn(),
      },
    })).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: [
        'Browser Automation',
        'status=disabled',
        'skill=browser-automation',
        'skillStatus=available',
        'activationStore=/workspace/.heddle/skills/activation.json',
        '',
        'Logged-in sites require a selected profile.',
        'Browser tools remain host-controlled.',
        '',
        'Commands',
        '  /browser enable',
        '  /browser disable',
      ].join('\n'),
    });
  });
});

describe('slash command registry', () => {
  it('finds exact, alias, and prefix-like commands through command-owned match predicates', async () => {
    const exact = command({
      id: 'help',
      syntax: '/help',
    });
    const alias = command({
      id: 'model.list',
      syntax: '/model list',
      aliases: ['/models'],
      match: SlashCommandParser.matchesAnyExact(['/model list', '/models']),
    });
    const prefix = command({
      id: 'session.switch',
      syntax: '/session switch <id>',
      match: SlashCommandParser.matchesPrefix('/session switch'),
    });
    const registry = new SlashCommandRegistry([moduleWith([exact, alias, prefix])]);

    expect(registry.find('/help')?.command.id).toBe('help');
    expect(registry.find('/models')?.command.id).toBe('model.list');
    expect(registry.find('/session switch session-a')?.command.id).toBe('session.switch');
    await expect(registry.run({ prefix: 'ctx' }, '/session switch session-a')).resolves.toEqual({
      kind: 'session.switch',
      value: 'ctx:switch session-a',
    });
  });

  it('returns undefined for non-command input and unmatched slash commands', async () => {
    const registry = new SlashCommandRegistry([moduleWith([
      command({ id: 'help', syntax: '/help' }),
    ])]);

    expect(registry.find('hello')).toBeUndefined();
    expect(registry.find('/unknown')).toBeUndefined();
    await expect(registry.run({ prefix: 'ctx' }, '/unknown')).resolves.toBeUndefined();
  });

  it('returns immutable command and hint snapshots', () => {
    const registry = new SlashCommandRegistry([moduleWith([
      command({ id: 'help', syntax: '/help', description: 'show help' }),
    ])]);

    const commands = registry.commands();
    const hints = registry.hints();
    commands.pop();
    hints.pop();

    expect(registry.commands()).toHaveLength(1);
    expect(registry.hints()).toEqual([{ command: '/help', description: 'show help' }]);
  });

  it('rejects duplicate module ids, command ids, syntaxes, and aliases', () => {
    const help = command({ id: 'help', syntax: '/help' });

    expect(() => new SlashCommandRegistry([
      { id: 'duplicate', commands: [help] },
      { id: 'duplicate', commands: [command({ id: 'model', syntax: '/model' })] },
    ])).toThrow('Duplicate slash command module id: duplicate');

    expect(() => new SlashCommandRegistry([moduleWith([
      command({ id: 'help', syntax: '/help' }),
      command({ id: 'help', syntax: '/help again' }),
    ])])).toThrow('Duplicate slash command id: help');

    expect(() => new SlashCommandRegistry([moduleWith([
      command({ id: 'help', syntax: '/help' }),
      command({ id: 'help.alias', syntax: '/help' }),
    ])])).toThrow('Duplicate slash command syntax: /help');

    expect(() => new SlashCommandRegistry([moduleWith([
      command({ id: 'model.list', syntax: '/model list', aliases: ['/models'] }),
      command({ id: 'models', syntax: '/models' }),
    ])])).toThrow('Duplicate slash command syntax: /models');
  });
});

describe('slash command autocomplete', () => {
  const hints = [
    { command: '/help', description: 'show help' },
    { command: '/model', description: 'show active model' },
    { command: '/model <name>', description: 'switch model' },
    { command: '/model set [query]', description: 'pick model' },
    { command: '/skills', description: 'list Agent Skills and activation status' },
    { command: '/skills enable <name>', description: 'activate one Agent Skill' },
    { command: '/skills disable <name>', description: 'disable one Agent Skill' },
    { command: '/session switch <id>', description: 'switch session' },
    { command: '/session close <id>', description: 'close session' },
  ];

  it('filters hints by command prefix and falls back for unmatched slash drafts', () => {
    expect(SlashCommandAutocomplete.filterHints('/session sw', hints)).toEqual([
      { command: '/session switch <id>', description: 'switch session' },
    ]);
    expect(SlashCommandAutocomplete.filterHints('/skills ', hints)).toEqual([
      { command: '/skills', description: 'list Agent Skills and activation status' },
      { command: '/skills enable <name>', description: 'activate one Agent Skill' },
      { command: '/skills disable <name>', description: 'disable one Agent Skill' },
    ]);
    expect(SlashCommandAutocomplete.filterHints('/nope', hints)).toEqual(hints);
    expect(SlashCommandAutocomplete.filterHints(absoluteScreenshotFixturePath, hints)).toEqual([]);
  });

  it('autocompletes shared prefixes and strips placeholders to tab-friendly candidates', () => {
    expect(SlashCommandAutocomplete.complete('/sess', hints)).toBe('/session ');
    expect(SlashCommandAutocomplete.complete('/session sw', hints)).toBe('/session switch ');
    expect(SlashCommandAutocomplete.complete('  /model s', hints)).toBe('  /model set ');
    expect(SlashCommandAutocomplete.complete(absoluteScreenshotFixturePath, hints)).toBeUndefined();
  });

  it('does not autocomplete already-maximal ambiguous prefixes or ordinary text', () => {
    expect(SlashCommandAutocomplete.complete('/model ', hints)).toBeUndefined();
    expect(SlashCommandAutocomplete.complete('hello', hints)).toBeUndefined();
  });

  it('does not call command run handlers while autocompleting', () => {
    const run = vi.fn();
    const registry = new SlashCommandRegistry([moduleWith([
      command({ id: 'help', syntax: '/help', run }),
    ])]);

    expect(SlashCommandAutocomplete.complete('/h', registry.hints())).toBe('/help');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('skills slash command output', () => {
  it('groups skills by activation status with per-skill actions', async () => {
    const views: AgentSkillActivationView[] = [
      {
        name: 'available-skill',
        status: 'available',
        catalogEntry: {
          name: 'available-skill',
          description: 'Can be enabled.',
          source: 'project',
          skillRoot: '/workspace/.agents/skills/available-skill',
          skillFilePath: '/workspace/.agents/skills/available-skill/SKILL.md',
        },
      },
      {
        name: 'active-skill',
        status: 'active',
        catalogEntry: {
          name: 'active-skill',
          description: 'Already active.',
          source: 'user',
          skillRoot: '/home/.agents/skills/active-skill',
          skillFilePath: '/home/.agents/skills/active-skill/SKILL.md',
        },
      },
      {
        name: 'disabled-skill',
        status: 'disabled',
        catalogEntry: {
          name: 'disabled-skill',
          description: 'Can be re-enabled.',
          source: 'project',
          skillRoot: '/workspace/.agents/skills/disabled-skill',
          skillFilePath: '/workspace/.agents/skills/disabled-skill/SKILL.md',
        },
      },
      {
        name: 'missing-skill',
        status: 'missing',
        record: {
          name: 'missing-skill',
          source: 'user',
          skillFilePath: '/home/.agents/skills/missing-skill/SKILL.md',
          status: 'active',
          activatedAt: '2026-06-08T10:00:00.000Z',
          updatedAt: '2026-06-08T10:00:00.000Z',
        },
      },
    ];

    await expect(listSkillsMessage({
      skills: {
        list: async () => views,
        activate: vi.fn(),
        disable: vi.fn(),
      },
    })).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: [
        'Agent Skills',
        '',
        'Active (1)',
        '- active-skill',
        '  Already active.',
        '  source=user',
        '  action=/skills disable active-skill',
        'Available (1)',
        '- available-skill',
        '  Can be enabled.',
        '  source=project',
        '  action=/skills enable available-skill',
        'Disabled (1)',
        '- disabled-skill',
        '  Can be re-enabled.',
        '  source=project',
        '  action=/skills enable disabled-skill',
        'Missing definitions (1)',
        '- missing-skill',
        '  skill definition is missing',
        '  source=user',
        '  action=restore SKILL.md or disable the stale activation record',
        '',
        'Commands',
        '  /skills enable <name>',
        '  /skills disable <name>',
      ].join('\n'),
    });
  });
});
