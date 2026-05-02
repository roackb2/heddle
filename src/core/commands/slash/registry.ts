import { parseSlashCommand } from './parser.js';
import type {
  ParsedSlashCommand,
  SlashCommand,
  SlashCommandHint,
  SlashCommandMatch,
  SlashCommandModule,
} from './types.js';

export type SlashCommandRegistry<Result, Context> = {
  commands(): SlashCommand<Result, Context>[];
  hints(): SlashCommandHint[];
  find(input: string | ParsedSlashCommand): SlashCommandMatch<Result, Context> | undefined;
  run(context: Context, input: string | ParsedSlashCommand): Promise<Result | undefined>;
};

export function createSlashCommandRegistry<Result, Context>(
  modules: SlashCommandModule<Result, Context>[],
): SlashCommandRegistry<Result, Context> {
  const commands = flattenModules(modules);
  const hints = flattenModuleHints(modules);
  validateSlashCommandRegistry(modules, commands);

  return {
    commands() {
      return [...commands];
    },

    hints() {
      return [...hints];
    },

    find(input) {
      const parsed = typeof input === 'string' ? parseSlashCommand(input) : input;
      if (!parsed) {
        return undefined;
      }

      const command = commands.find((candidate) => candidate.match(parsed));
      return command ? { command, input: parsed } : undefined;
    },

    async run(context, input) {
      const matched = this.find(input);
      return matched ? await matched.command.run(context, matched.input) : undefined;
    },
  };
}

function flattenModuleHints<Result, Context>(
  modules: SlashCommandModule<Result, Context>[],
): SlashCommandHint[] {
  return modules.flatMap((module) =>
    module.hints ?? module.commands.map((command) => ({
      command: command.syntax,
      description: command.description,
    })),
  );
}

function flattenModules<Result, Context>(
  modules: SlashCommandModule<Result, Context>[],
): SlashCommand<Result, Context>[] {
  return modules.flatMap((module) => module.commands);
}

function validateSlashCommandRegistry<Result, Context>(
  modules: SlashCommandModule<Result, Context>[],
  commands: SlashCommand<Result, Context>[],
) {
  assertUnique('slash command module id', modules.map((module) => module.id));
  assertUnique('slash command id', commands.map((command) => command.id));
  assertUnique(
    'slash command syntax',
    commands.flatMap((command) => [command.syntax, ...(command.aliases ?? [])]),
  );
}

function assertUnique(label: string, values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}
