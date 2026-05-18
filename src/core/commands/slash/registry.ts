import { SlashCommandParser } from './parser.js';
import type {
  ParsedSlashCommand,
  SlashCommand,
  SlashCommandHint,
  SlashCommandMatch,
  SlashCommandModule,
} from './types.js';

/**
 * Registers slash-command modules and dispatches parsed command input.
 */
export class SlashCommandRegistry<Result, Context> {
  private readonly commandList: SlashCommand<Result, Context>[];
  private readonly hintList: SlashCommandHint[];

  constructor(modules: SlashCommandModule<Result, Context>[]) {
    this.commandList = SlashCommandRegistry.flattenModules(modules);
    this.hintList = SlashCommandRegistry.flattenModuleHints(modules);
    SlashCommandRegistry.validate(modules, this.commandList);
  }

  commands(): SlashCommand<Result, Context>[] {
    return [...this.commandList];
  }

  hints(): SlashCommandHint[] {
    return [...this.hintList];
  }

  find(input: string | ParsedSlashCommand): SlashCommandMatch<Result, Context> | undefined {
    const parsed = typeof input === 'string' ? SlashCommandParser.parse(input) : input;
    if (!parsed) {
      return undefined;
    }

    const command = this.commandList.find((candidate) => candidate.match(parsed));
    return command ? { command, input: parsed } : undefined;
  }

  async run(context: Context, input: string | ParsedSlashCommand): Promise<Result | undefined> {
    const matched = this.find(input);
    return matched ? await matched.command.run(context, matched.input) : undefined;
  }

  private static flattenModuleHints<Result, Context>(
    modules: SlashCommandModule<Result, Context>[],
  ): SlashCommandHint[] {
    return modules.flatMap((module) =>
      module.hints ?? module.commands.map((command) => ({
        command: command.syntax,
        description: command.description,
      })),
    );
  }

  private static flattenModules<Result, Context>(
    modules: SlashCommandModule<Result, Context>[],
  ): SlashCommand<Result, Context>[] {
    return modules.flatMap((module) => module.commands);
  }

  private static validate<Result, Context>(
    modules: SlashCommandModule<Result, Context>[],
    commands: SlashCommand<Result, Context>[],
  ) {
    SlashCommandRegistry.assertUnique('slash command module id', modules.map((module) => module.id));
    SlashCommandRegistry.assertUnique('slash command id', commands.map((command) => command.id));
    SlashCommandRegistry.assertUnique(
      'slash command syntax',
      commands.flatMap((command) => [command.syntax, ...(command.aliases ?? [])]),
    );
  }

  private static assertUnique(label: string, values: string[]) {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) {
        throw new Error(`Duplicate ${label}: ${value}`);
      }
      seen.add(value);
    }
  }
}
