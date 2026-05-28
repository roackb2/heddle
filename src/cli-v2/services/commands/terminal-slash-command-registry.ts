import { TerminalSlashCommandParser } from './terminal-slash-command-parser.js';
import type {
  ParsedTerminalSlashCommand,
  TerminalSlashCommandContext,
  TerminalSlashCommandDefinition,
  TerminalSlashCommandHint,
  TerminalSlashCommandModule,
  TerminalSlashCommandResult,
} from './types.js';

/**
 * Registers cli-v2 slash-command modules and dispatches parsed input.
 */
export class TerminalSlashCommandRegistry {
  private readonly commandList: TerminalSlashCommandDefinition[];
  private readonly hintList: TerminalSlashCommandHint[];

  constructor(modules: TerminalSlashCommandModule[]) {
    this.commandList = modules.flatMap((module) => module.commands);
    this.hintList = modules.flatMap((module) =>
      module.hints ?? module.commands.map((command) => ({
        command: command.syntax,
        description: command.description,
      })),
    );
    TerminalSlashCommandRegistry.validate(modules, this.commandList);
  }

  hints(): TerminalSlashCommandHint[] {
    return [...this.hintList];
  }

  find(input: string | ParsedTerminalSlashCommand): TerminalSlashCommandDefinition | undefined {
    const parsed = typeof input === 'string' ? TerminalSlashCommandParser.parse(input) : input;
    return parsed ? this.commandList.find((command) => command.match(parsed)) : undefined;
  }

  async execute(
    context: TerminalSlashCommandContext,
    input: string | ParsedTerminalSlashCommand,
  ): Promise<TerminalSlashCommandResult | undefined> {
    const parsed = typeof input === 'string' ? TerminalSlashCommandParser.parse(input) : input;
    if (!parsed) {
      return undefined;
    }

    const command = this.commandList.find((candidate) => candidate.match(parsed));
    return command ? await command.execute(context, parsed) : undefined;
  }

  private static validate(
    modules: TerminalSlashCommandModule[],
    commands: TerminalSlashCommandDefinition[],
  ): void {
    TerminalSlashCommandRegistry.assertUnique('cli-v2 slash command module id', modules.map((module) => module.id));
    TerminalSlashCommandRegistry.assertUnique('cli-v2 slash command id', commands.map((command) => command.id));
    TerminalSlashCommandRegistry.assertUnique(
      'cli-v2 slash command syntax',
      commands.flatMap((command) => [command.syntax, ...(command.aliases ?? [])]),
    );
  }

  private static assertUnique(label: string, values: string[]): void {
    const seen = new Set<string>();
    values.forEach((value) => {
      if (seen.has(value)) {
        throw new Error(`Duplicate ${label}: ${value}`);
      }
      seen.add(value);
    });
  }
}
