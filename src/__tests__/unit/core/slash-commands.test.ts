import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SlashCommandAutocomplete } from '../../../core/commands/slash/autocomplete.js';
import { SlashCommandParser } from '../../../core/commands/slash/parser.js';
import { SlashCommandRegistry } from '../../../core/commands/slash/registry.js';
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
    { command: '/session switch <id>', description: 'switch session' },
    { command: '/session close <id>', description: 'close session' },
  ];

  it('filters hints by command prefix and falls back for unmatched slash drafts', () => {
    expect(SlashCommandAutocomplete.filterHints('/session sw', hints)).toEqual([
      { command: '/session switch <id>', description: 'switch session' },
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
