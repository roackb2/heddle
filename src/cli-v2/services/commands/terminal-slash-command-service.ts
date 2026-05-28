import { createTerminalSlashCommandModules } from './modules/terminal-command-modules.js';
import { terminalSlashStatusResult } from './modules/results.js';
import { TerminalSlashCommandParser } from './terminal-slash-command-parser.js';
import { TerminalSlashCommandRegistry } from './terminal-slash-command-registry.js';
import type {
  TerminalSlashCommandContext,
  TerminalSlashCommandResult,
} from './types.js';

/**
 * Owns cli-v2 terminal prompt slash-command parsing and dispatch.
 */
export class TerminalSlashCommandService {
  private readonly registry = new TerminalSlashCommandRegistry(createTerminalSlashCommandModules());

  isSlashCommand(input: string): boolean {
    return TerminalSlashCommandParser.isInput(input);
  }

  async execute(input: string, context: TerminalSlashCommandContext): Promise<TerminalSlashCommandResult> {
    const parsed = TerminalSlashCommandParser.parse(input);
    if (!parsed) {
      return { handled: false };
    }

    if (parsed.raw === '/help') {
      return terminalSlashStatusResult('CLI v2 commands', this.formatHelp(), 'info');
    }

    const result = await this.registry.execute(context, parsed);
    if (result) {
      return result;
    }

    return {
      handled: true,
      error: `Unknown cli-v2 slash command: ${parsed.root}. Use /help to inspect supported commands.`,
    };
  }

  private formatHelp(): string {
    return [
      { command: '/help', description: 'list supported cli-v2 slash commands' },
      ...this.registry.hints(),
    ]
      .map((hint) => `${hint.command} - ${hint.description}`)
      .join('\n');
  }
}

export type {
  TerminalSlashCommandContext,
  TerminalSlashCommandResult,
} from './types.js';
